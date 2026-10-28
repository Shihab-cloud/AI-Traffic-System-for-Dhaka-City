import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { toNodeHandler } from 'better-auth/node';
import { customSession, jwt, openAPI, username } from 'better-auth/plugins';
import { magicLink } from 'better-auth/plugins/magic-link';
import type Redis from 'ioredis';
import type { Db } from 'mongodb';
import { Types } from 'mongoose'; // Imported to manually cast ObjectIds
import type { MailService } from 'src/modules/mail/mail.service';
import type { InvalidatedTokenModel } from 'src/schemas/auth/token.schema';
import type { RoleModel } from 'src/schemas/public/role.schema';
import type { UserModel } from 'src/schemas/public/user.schema';
import { AmrEnum } from 'src/shared/enums/auth.enum';
import { RoleNameEnum } from 'src/shared/enums/role-name.enum';
import { UserStatusEnum } from 'src/shared/enums/status.enum';
import { hashPassword, verifyPassword } from 'src/utils/password.util';
import {
  RATE_LIMIT_CUSTOM_RULES,
  createRedisRateLimitStorage,
  parseTrustedProxies,
} from './rate-limit';
import { SESSION_EXPIRY_SECONDS } from './session.constants';

// ============================================================================
// Constants & Types
// ============================================================================

const DEFAULT_JWT_EXPIRY_SECONDS = 15 * 60;
const MAGIC_LINK_EXPIRY_SECONDS = 24 * 60 * 60;
const VERIFY_EMAIL_EXPIRY_SECONDS = 24 * 60 * 60;

interface ExtendedUser {
  id: string;
  email?: string;
  name: string;
  emailVerified?: boolean;
  roleId?: string | Types.ObjectId;
  mustResetPassword?: boolean;
  firstName?: string;
  lastName?: string;
  displayUsername?: string;
  pendingTempPassword?: string;
}

/**
 * MFA state merged into JWT payloads / customSession output. Structural
 * superset of MfaService's `PendingState` (aal widened to `number`) so the
 * MFA module can evolve its internal state without touching this file.
 */
export interface MfaSessionEnrichment {
  aal?: number;
  amr?: AmrEnum[];
  mfa_at?: number;
  enrollment_required?: boolean;
}

export interface MfaIntegrationHooks {
  onLoginSessionCreating?: (input: {
    session: { userId: string; ipAddress?: string | null; userAgent?: string | null };
    request?: Request;
  }) => Promise<void>;
  onLoginSessionCreated?: (input: { session: { id: string; userId: string } }) => Promise<void>;
  enrichJwtPayload?: (input: {
    userId: string;
    sessionId: string;
  }) => Promise<MfaSessionEnrichment | null>;
  enrichSession?: (input: {
    userId: string;
    sessionId: string;
  }) => Promise<MfaSessionEnrichment | null>;
  onAccountCreated?: (account: { providerId: string; userId: string }) => Promise<void>;
  /**
   * Fired when a user's credential password changes — reset-with-token or an
   * authenticated change. MFA uses it to drop device trust, since a password
   * reset is the action a user takes to evict someone from their account and
   * must not leave that someone a 30-day MFA bypass.
   */
  onPasswordChanged?: (input: { userId: string }) => Promise<void>;
}

interface BetterAuthOptions {
  db: Db;
  /**
   * Shared ioredis client (`REDIS_CLIENT`). Backs the rate-limit counters so
   * they are atomic and shared across replicas. An in-process Map gives each
   * container its own counters, which multiplies every limit by the replica
   * count and resets them all on deploy — and it duplicates Better Auth's own
   * `memory` backend, which already exists for that purpose.
   */
  redis: Redis;
  userModel: UserModel;
  roleModel: RoleModel;
  invalidatedTokenModel: InvalidatedTokenModel;
  frontendUrl: string;
  backendUrl: string;
  betterAuthSecret: string;
  mailService: MailService;
  googleClientId?: string;
  googleClientSecret?: string;
  jwtExpirySeconds?: number;
  mfa?: MfaIntegrationHooks;
  /**
   * Runtime gate for verification emails, read from system settings. Called
   * per-send inside `sendVerificationEmail`. When it resolves `false`, the
   * email is skipped. Omit to preserve always-send behavior.
   */
  isEmailVerificationEnabled?: () => Promise<boolean>;
  /**
   * Runtime gate for public self-registration, read from system settings.
   *
   * Enforced in two places, because one alone is not enough:
   *
   *  - `hooks.before` on `POST /sign-up/email`, which rejects early with a
   *    clean `SIGNUP_DISABLED` before any user row is touched.
   *  - `databaseHooks.user.create.before`, the choke point every Better Auth
   *    sign-up path funnels through — including the social callback, which the
   *    route hook never sees.
   *
   * Deliberately not `emailAndPassword.disableSignUp` or the provider's own
   * `disableSignUp`: both are read once at construction and cannot follow a
   * live toggle.
   *
   * Gating `user.create` is safe here because **nothing in this app creates a
   * user through Better Auth except self-registration** — admin provisioning
   * and the bootstrap admin write the `users` row through Mongoose directly,
   * so this hook never fires for them. If that ever changes, this gate starts
   * blocking admin-created accounts.
   *
   * Omit to preserve always-open behavior.
   */
  isSignUpEnabled?: () => Promise<boolean>;
  /**
   * Comma-separated IPs/CIDR ranges of the reverse proxies in front of this
   * service (`TRUSTED_PROXY_CIDRS`). Required for the rate limiter to resolve a
   * real client IP out of a multi-hop `x-forwarded-for` chain — see
   * `rate-limit.ts` for why. Omit to use the Docker-bridge defaults.
   */
  trustedProxyCidrs?: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeObjectId(id: unknown): string | null {
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (typeof id === 'object' && 'buffer' in id && id.buffer) {
    // ObjectId deserialized to a plain object keeps only its raw byte buffer.
    return Buffer.from(id.buffer as Uint8Array).toString('hex');
  }
  // Remaining case is an intact BSON ObjectId — toString() yields the hex form.
  return (id as Types.ObjectId).toString();
}

async function buildJwtPayload(
  sessionCtx: { user: { id: string; email: string | null }; session: unknown },
  userModel: UserModel,
  mfa: MfaIntegrationHooks | undefined,
) {
  const session = sessionCtx.session as { token?: string; id?: string };
  const sessionId = session.token ?? session.id ?? '';

  const dbUser = await userModel
    .findById(sessionCtx.user.id)
    .select('email mustResetPassword roleId')
    .populate('role')
    .lean();

  const role = dbUser?.role;
  const rolePart = role
    ? {
        role: {
          id: String(role._id),
          name: role.name,
          permissions: role.permissions ?? [],
          rank: role.rank,
        },
      }
    : { role: null };

  const mfaState = mfa?.enrichJwtPayload
    ? await mfa.enrichJwtPayload({ userId: sessionCtx.user.id, sessionId }).catch(() => null)
    : null;

  return {
    sub: sessionCtx.user.id,
    ...(sessionCtx.user.email && { email: sessionCtx.user.email }),
    sid: sessionId,
    ...rolePart,
    aal: mfaState?.aal ?? 1,
    amr: mfaState?.amr ?? [AmrEnum.PWD],
    ...(mfaState?.mfa_at && { mfa_at: mfaState.mfa_at }),
    ...(mfaState?.enrollment_required && { enrollment_required: true }),
    ...(dbUser?.mustResetPassword && { activation_required: true }),
  };
}

// ============================================================================
// Better Auth Initialization
// ============================================================================

export function createBetterAuth(options: BetterAuthOptions) {
  const {
    db,
    redis,
    userModel,
    roleModel,
    invalidatedTokenModel,
    frontendUrl,
    backendUrl,
    betterAuthSecret,
    mailService,
    googleClientId,
    googleClientSecret,
    jwtExpirySeconds = DEFAULT_JWT_EXPIRY_SECONDS,
    mfa,
    isEmailVerificationEnabled,
    isSignUpEnabled,
    trustedProxyCidrs,
  } = options;

  const trustedProxies = parseTrustedProxies(trustedProxyCidrs);
  console.log(`[better-auth] Trusted reverse proxies: ${trustedProxies.join(', ')}`);

  const auth = betterAuth({
    secret: betterAuthSecret,
    basePath: '/api/auth',
    trustedOrigins: (request) => {
      const origins = [frontendUrl, backendUrl];
      const origin = request?.headers.get('origin');
      if (origin) origins.push(origin);
      return origins;
    },

    advanced: {
      database: { generateId: false },
      // Without this the rate limiter cannot read a client IP out of the
      // multi-hop `x-forwarded-for` chain the nginx layers and the Next auth
      // proxy build up, and it buckets the whole instance under one shared key.
      // See `rate-limit.ts` for the full explanation.
      ipAddress: { trustedProxies },
    },
    rateLimit: {
      // Better Auth enables the limiter only when NODE_ENV=production. Left at
      // that default so development keeps its unthrottled behaviour.
      customRules: RATE_LIMIT_CUSTOM_RULES,
      customStorage: createRedisRateLimitStorage(redis),
    },
    database: mongodbAdapter(db, { usePlural: true }),

    // Aligned precisely with the Mongoose schema
    user: {
      additionalFields: {
        // `input: false` on every field that decides authority. Without it
        // Better Auth accepts them on `POST /api/auth/update-user`, so a user
        // can assign themselves a role, clear their own activation gate, or read
        // back a temp password, bypassing the server-side rank checks. Every
        // field below is written by hooks or admin services, never by the user.
        firstName: { type: 'string', required: false },
        lastName: { type: 'string', required: false },
        displayUsername: { type: 'string', required: false },
        mustResetPassword: { type: 'boolean', required: false, defaultValue: false, input: false },
        pendingTempPassword: { type: 'string', required: false, input: false },
        phone: { type: 'string', required: false },
        roleId: { type: 'string', required: false, input: false }, // cast to ObjectId in hooks
        status: {
          type: 'string',
          required: false,
          defaultValue: UserStatusEnum.ACTIVE,
          input: false,
        },
      },
    },
    session: {
      // Pinned rather than left implicit: `mfa-session-state.store.ts` sizes its
      // TTL against this, and a session that outlives its MFA state silently
      // drops back to AAL1.
      expiresIn: SESSION_EXPIRY_SECONDS,
      cookieCache: { enabled: false },
      additionalFields: {
        aal: { type: 'number', required: false, input: false },
        enrollment_required: { type: 'boolean', required: false, input: false },
        activation_required: { type: 'boolean', required: false, input: false },
      },
    },

    emailAndPassword: {
      enabled: true,
      password: {
        hash: async (password) => hashPassword(password),
        verify: async ({ hash, password }) => verifyPassword(password, hash),
      },
      sendResetPassword: async ({ user, token }) => {
        const u = user as ExtendedUser;
        if (!u.emailVerified) return;
        await mailService.resetPassword(
          user.email,
          `${frontendUrl}/auth/reset-password/${token}`,
          user.name || 'User',
        );
      },
    },
    emailVerification: {
      autoSignInAfterVerification: false,
      expiresIn: VERIFY_EMAIL_EXPIRY_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        // Runtime gate: admins can disable verification emails instance-wide via
        // system settings (default off). This is the single chokepoint — both
        // the provisioning path and BA-internal sends funnel through here.
        if (isEmailVerificationEnabled && !(await isEmailVerificationEnabled())) {
          console.warn(
            `[better-auth] Skipping verification email for ${user.email} — disabled by system settings`,
          );
          return;
        }
        await mailService.sendVerifyEmail(user.email, url, VERIFY_EMAIL_EXPIRY_SECONDS);
      },
    },
    socialProviders:
      googleClientId && googleClientSecret
        ? {
            google: { clientId: googleClientId, clientSecret: googleClientSecret },
          }
        : undefined,

    plugins: [
      // Better Auth's `twoFactor()` plugin is deliberately not registered: MFA is
      // owned end-to-end by `src/modules/auth/mfa`. Enabling it would add a second,
      // unenforced enrollment path and a second source of truth.
      openAPI({ disableDefaultReference: true }),
      username({
        usernameValidator: (u) => /^[a-zA-Z0-9_.-]+$/.test(u),
        minUsernameLength: 3,
        maxUsernameLength: 60,
      }),
      jwt({
        jwt: {
          issuer: backendUrl,
          audience: backendUrl,
          expirationTime: `${jwtExpirySeconds}s`,
          definePayload: (sessionCtx) => buildJwtPayload(sessionCtx, userModel, mfa),
        },
      }),
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRY_SECONDS,
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          await mailService.sendMagicLink(email, url, MAGIC_LINK_EXPIRY_SECONDS);
        },
      }),
      customSession(async ({ user, session }) => {
        const u = user as ExtendedUser;
        const roleIdStr = normalizeObjectId(u.roleId);

        const role = roleIdStr ? await roleModel.findById(roleIdStr).lean() : null;

        const s = session as { token?: string; id?: string };
        const sessionId = s.token ?? s.id ?? '';

        const sessionExt = await mfa
          ?.enrichSession?.({ userId: u.id, sessionId })
          .catch(() => null);
        const sessionExtras: Record<string, any> = {};

        if (sessionExt?.aal) sessionExtras.aal = sessionExt.aal;
        if (sessionExt?.enrollment_required) sessionExtras.enrollment_required = true;
        if (u.mustResetPassword) sessionExtras.activation_required = true;

        return {
          user: { ...user, role },
          session: { ...session, ...sessionExtras },
        };
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        if (!isSignUpEnabled || (await isSignUpEnabled())) return;
        throw new APIError('FORBIDDEN', { message: 'SIGNUP_DISABLED' });
      }),
    },
    databaseHooks: {
      account: {
        create: {
          after: async (account) => {
            if (mfa?.onAccountCreated) {
              await mfa.onAccountCreated({
                providerId: account.providerId,
                userId: account.userId,
              });
            }
          },
        },
        update: {
          // Hooked at the database layer rather than on the `/reset-password`
          // and `/change-password` routes: the credential account row is where
          // the password actually lives, so every flow that changes it is
          // covered — including any Better Auth adds later.
          //
          // Social providers also update their account rows on token refresh,
          // which is why this is gated on the credential provider. Over-firing
          // would only revoke device trust, which is fail-safe, but it would
          // also be noise in the audit log.
          after: async (account) => {
            if (account.providerId !== 'credential') return;
            if (mfa?.onPasswordChanged) {
              await mfa.onPasswordChanged({ userId: account.userId });
            }
          },
        },
      },
      user: {
        create: {
          before: async (user) => {
            // Every Better Auth sign-up path lands here, so this is what closes
            // the social-callback gap the `/sign-up/email` route hook leaves
            // open. Admin-provisioned users bypass Better Auth entirely and so
            // never reach this hook — see `isSignUpEnabled` above.
            if (isSignUpEnabled && !(await isSignUpEnabled())) {
              throw new APIError('FORBIDDEN', { message: 'SIGNUP_DISABLED' });
            }

            const u = user as ExtendedUser;

            // 1. Manually sync Name/FirstName/LastName (bypasses Mongoose pre-save)
            if (u.firstName || u.lastName) {
              u.name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '';
            } else if (u.name && !u.firstName) {
              const [firstName, ...rest] = u.name.split(' ');
              u.firstName = firstName;
              u.lastName = rest.join(' ') || firstName;
            }

            // 2. Protect the Partial Index: explicitly delete null/empty emails
            if (!u.email) {
              delete u.email;
            }

            // 3. Assign Default Role and strictly cast to a native ObjectId
            if (!u.roleId) {
              const defaultRole =
                (await roleModel.findOne({ isDefault: true }).lean()) ??
                (await roleModel.findOne({ name: RoleNameEnum.USER }).lean());

              if (defaultRole) {
                u.roleId = defaultRole._id; // Inherit the raw BSON ObjectId
              }
            } else if (typeof u.roleId === 'string') {
              u.roleId = new Types.ObjectId(u.roleId); // Cast explicitly
            }

            return { data: u };
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const usr = await userModel.findById(session.userId).select('status').lean();
            if (usr?.status === UserStatusEnum.BANNED) {
              throw new APIError('FORBIDDEN', { message: 'ACCOUNT_BANNED' });
            }
            if (mfa?.onLoginSessionCreating) {
              await mfa.onLoginSessionCreating({
                session: {
                  userId: session.userId,
                  ipAddress: session.ipAddress ?? null,
                  userAgent: session.userAgent ?? null,
                },
                request: ctx?.request,
              });
            }
          },
          after: async (sessionRaw) => {
            const session = sessionRaw;
            // Handled via Mongoose, so hooks will run here if needed in the future
            await userModel.findByIdAndUpdate(session.userId, { lastLoginAt: new Date() });

            if (mfa?.onLoginSessionCreated) {
              const sessionId = session.token ?? session.id;
              if (sessionId) {
                await mfa.onLoginSessionCreated({
                  session: { id: sessionId, userId: session.userId },
                });
              }
            }
          },
        },
        delete: {
          after: async (session) => {
            await invalidatedTokenModel.create({
              userId: session.userId,
              invalidatedAt: new Date(),
            });
          },
        },
      },
    },
    onAPIError: {
      onError: (e: unknown) => console.error('[better-auth]', e instanceof Error ? e.message : e),
    },
  });

  return { auth, handler: toNodeHandler(auth) };
}
