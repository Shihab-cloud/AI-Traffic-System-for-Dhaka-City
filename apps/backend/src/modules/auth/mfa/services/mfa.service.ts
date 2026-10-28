import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { APIError } from 'better-auth/api';

import type { MfaIntegrationHooks } from 'src/lib/auth/better-auth';
import type {
  AuditInput,
  ChallengeContext,
  ChallengeStarted,
  DisableAllInput,
  EnrollFactorInput,
  ListedFactor,
  StartChallengeInput,
  VerifyChallengeInput,
  VerifyChallengeResult,
} from 'src/lib/types/mfa.types';
import { TokenService } from 'src/modules/auth/token/token.service';
import { NotificationService } from 'src/modules/notification/notification.service';
import { SystemSettingsService } from 'src/modules/system-settings/system-settings.service';
import { MfaBackupCode, MfaBackupCodeModel } from 'src/schemas/mfa/backup-code.schema';
import { MfaChallenge, MfaChallengeModel } from 'src/schemas/mfa/challenge.schema';
import { MfaFactorSecret, MfaFactorSecretModel } from 'src/schemas/mfa/factor-secret.schema';
import { MfaFactor, MfaFactorModel } from 'src/schemas/mfa/factor.schema';
import { MfaAudit, MfaAuditModel } from 'src/schemas/mfa/mfa-audit.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { AmrEnum } from 'src/shared/enums/auth.enum';
import {
  MfaAuditEventEnum,
  MfaChallengePurposeEnum,
  MfaFactorStatusEnum,
  MfaFactorTypeEnum,
} from 'src/shared/enums/mfa.enum';
import { NotificationChannelEnum } from 'src/shared/enums/notification-channel.enum';
import type { FactorAdapter, FactorEnrollResult } from '../factors/factor.adapter';
import { MFA_FACTOR_ADAPTERS } from '../mfa.tokens';
import { LoginAttemptStore } from './login-attempt.store';
import { MfaSessionStateStore } from './mfa-session-state.store';
import { PolicyService } from './policy.service';
import { RecoveryService } from './recovery.service';
import { TRUSTED_DEVICE_COOKIE_NAME, TrustedDeviceService } from './trusted-device.service';

const LOGIN_CHALLENGE_TTL_MIN = 10;
const STEP_UP_CHALLENGE_TTL_MIN = 5;

/** Lean challenge document shape used by internal helpers. */
interface ChallengeDoc {
  // Typed `string` to match BaseSchema's declared `_id` (mongoose 9 filters on
  // this model accept the raw doc's `_id` type); at runtime it is an ObjectId,
  // which mongoose casts transparently.
  _id: string;
  userId: string;
  factorType: MfaFactorTypeEnum;
  purpose: MfaChallengePurposeEnum;
  payloadHash?: string | null;
  payloadSalt?: string | null;
  attemptsRemaining: number;
  scope?: string | null;
  context?: Record<string, unknown> | null;
  expiresAt: Date;
}

@Injectable()
export class MfaService implements MfaIntegrationHooks {
  private readonly logger = new Logger(MfaService.name);
  private readonly registry: Map<MfaFactorTypeEnum, FactorAdapter>;

  constructor(
    @InjectModel(MfaFactor.name) private readonly factorModel: MfaFactorModel,
    @InjectModel(MfaFactorSecret.name) private readonly secretModel: MfaFactorSecretModel,
    @InjectModel(MfaChallenge.name) private readonly challengeModel: MfaChallengeModel,
    @InjectModel(MfaBackupCode.name) private readonly backupCodeModel: MfaBackupCodeModel,
    @InjectModel(MfaAudit.name) private readonly auditModel: MfaAuditModel,
    @InjectModel(User.name) private readonly userModel: UserModel,
    @Inject(MFA_FACTOR_ADAPTERS) adapters: FactorAdapter[],
    private readonly trustedDevices: TrustedDeviceService,
    private readonly recovery: RecoveryService,
    private readonly attempts: LoginAttemptStore,
    private readonly sessions: MfaSessionStateStore,
    private readonly policy: PolicyService,
    private readonly config: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly tokenService: TokenService,
    private readonly systemSettings: SystemSettingsService,
  ) {
    this.registry = new Map();
    for (const adapter of adapters) {
      if (this.registry.has(adapter.type)) {
        throw new Error(`Duplicate factor adapter for type ${adapter.type}`);
      }
      this.registry.set(adapter.type, adapter);
    }
    if (!this.config.get<string>('MFA_ENROLLMENT_GRACE_DEADLINE')) {
      this.logger.warn(
        'MFA_ENROLLMENT_GRACE_DEADLINE is not set — mandatory-enrollment users will be hard-blocked at sign-in until they enroll out-of-band',
      );
    }
  }

  /**
   * Returns true if the configured grace deadline (UTC ISO-8601) is in the
   * future. Empty / unparseable env var fails closed (no grace).
   */
  private isWithinGracePeriod(): boolean {
    const raw = this.config.get<string>('MFA_ENROLLMENT_GRACE_DEADLINE');
    if (!raw) return false;
    const ts = Date.parse(raw);
    if (Number.isNaN(ts)) return false;
    return ts > Date.now();
  }

  // ─── BA hook callbacks ───────────────────────────────────────────────────
  // Implements `MfaIntegrationHooks` so `BetterAuthProvider` injects only
  // `MfaService` (not the internal collaborators). State machine:
  //
  //   POST /api/auth/sign-in/email
  //     ↓
  //   BA verifies password → enters session.create.before
  //     ↓
  //   onLoginSessionCreating:
  //     - if proof for userId exists      → consume + write pending state (AAL2)
  //     - else if user has active factors → throw 401 MFA_REQUIRED with
  //                                         { attemptToken, availableFactors }
  //     - else if mandatory-enrollment    → throw 403 MFA_ENROLL_REQUIRED
  //     - else                            → allow at AAL1
  //
  //   On 401 MFA_REQUIRED, frontend calls public endpoints (mounted by
  //   MfaController under @Public()):
  //
  //     POST /api/mfa/login/challenge { attemptToken, factorType }
  //     POST /api/mfa/login/verify    { attemptToken, challengeId, code }
  //                                   → emits proof keyed on userId
  //
  //   Frontend retries /api/auth/sign-in/email; this time the proof is found,
  //   pending state is set to AAL2, session.create.after persists session
  //   state, enrichJwtPayload reads it for the JWT.

  onLoginSessionCreating: MfaIntegrationHooks['onLoginSessionCreating'] = async ({
    session,
    request,
  }) => {
    const userId = session.userId;

    const proof = await this.attempts.consumeProof(userId);
    if (proof) {
      await this.sessions.setPending(userId, {
        aal: 2,
        amr: proof.amr,
        mfa_at: proof.mfa_at,
      });
      return;
    }

    // Trusted device: a valid `mfa.trusted_device` cookie (signature + live DB
    // row + fingerprint match) skips the LOGIN challenge only — step-up always
    // re-challenges. Resolved before the policy decision so `evaluateLogin` can
    // weigh it, and so a trusted browser signs in on password alone at AAL2.
    const trusted = await this.trustedDevices.isTrusted({
      cookieValue: readCookie(request, TRUSTED_DEVICE_COOKIE_NAME),
      userId,
      userAgent: session.userAgent ?? null,
      ip: session.ipAddress ?? null,
    });

    const decision = await this.policy.evaluateLogin({
      userId,
      trustedDevice: !!trusted,
    });

    if (decision.kind === 'allow') {
      await this.sessions.setPending(userId, {
        aal: trusted ? 2 : 1,
        amr: decision.amr,
        ...(trusted && { mfa_at: Math.floor(Date.now() / 1000) }),
      });
      return;
    }

    if (decision.kind === 'enroll_required') {
      if (!this.isWithinGracePeriod()) {
        throw new APIError('FORBIDDEN', { message: 'MFA_ENROLL_REQUIRED' });
      }

      // Within grace: allow at AAL1 with a flag the FE uses to redirect to enrollment.
      await this.sessions.setPending(userId, {
        aal: 1,
        amr: [AmrEnum.PWD],
        enrollment_required: true,
      });
      return;
    }

    // Has an active factor and no trusted device — challenge required. Mint an
    // attempt token so the public /mfa/login/* endpoints can be authorized for
    // this user without a session/JWT (which doesn't exist yet).
    const attemptToken = await this.attempts.mintAttempt(userId);
    await this.audit({
      userId,
      event: MfaAuditEventEnum.VERIFY_FAIL,
      ip: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      metadata: { stage: 'login', reason: 'challenge_required' },
    });
    throw new APIError('UNAUTHORIZED', {
      message: 'MFA_REQUIRED',
      mfa: { attemptToken, availableFactors: decision.availableFactors },
    });
  };

  onLoginSessionCreated: MfaIntegrationHooks['onLoginSessionCreated'] = async ({ session }) => {
    const pending = await this.sessions.getPending(session.userId);
    if (pending) {
      await this.sessions.setSessionState(session.id, pending);
      await this.sessions.clearPending(session.userId);
    } else {
      // Defensive default: no pending state means the hook wasn't reached
      // (e.g. cookie-cache refresh path). Persist a baseline so JWT enrichment
      // has something to read.
      await this.sessions.setSessionState(session.id, { aal: 1, amr: [AmrEnum.PWD] });
    }
  };

  enrichJwtPayload: MfaIntegrationHooks['enrichJwtPayload'] = async ({ sessionId }) => {
    const state = await this.sessions.getSessionState(sessionId);
    if (!state) return null;
    return {
      aal: state.aal,
      amr: state.amr,
      mfa_at: state.mfa_at,
      enrollment_required: state.enrollment_required,
    };
  };

  /**
   * Future-proof account-link gate. Today: no-op (Google OAuth not in prod).
   */
  onAccountCreated: MfaIntegrationHooks['onAccountCreated'] = async () => {
    // intentionally no-op
  };

  /**
   * Drop every trusted device when the account password changes.
   *
   * A password reset is what a user does to evict someone who has got into
   * their account. Device trust skips the login MFA challenge for 30 days, so
   * leaving it in place would let the intruder keep signing in with the new
   * password and no second factor — exactly the outcome the reset was meant to
   * prevent.
   *
   * Sessions are deliberately NOT invalidated here: Better Auth already
   * handles session revocation on its own password routes, and doing it again
   * would sign the user out of the tab they just changed their password in.
   */
  onPasswordChanged: MfaIntegrationHooks['onPasswordChanged'] = async ({ userId }) => {
    await this.trustedDevices.revokeAll(userId);
    await this.audit({
      userId,
      event: MfaAuditEventEnum.TRUST_DEVICE_REVOKED,
      metadata: { reason: 'password_changed', scope: 'all' },
    });
  };

  // ─── Session state pass-throughs (consumed outside MfaModule) ────────────

  getSessionState(sessionId: string) {
    return this.sessions.getSessionState(sessionId);
  }

  revokeSessionState(sessionId: string): Promise<void> {
    return this.sessions.revokeSessionState(sessionId);
  }

  // ─── Adapter resolution ──────────────────────────────────────────────────

  getAdapter(type: MfaFactorTypeEnum): FactorAdapter {
    const adapter = this.registry.get(type);
    if (!adapter) throw new Error(`No adapter registered for factor type ${type}`);
    return adapter;
  }

  // ─── Enrollment ──────────────────────────────────────────────────────────

  async enroll(input: EnrollFactorInput): Promise<FactorEnrollResult> {
    // Instance-wide gate: when MFA is disabled (default), no new factors may be
    // enrolled. Already-enrolled users keep their factors and login challenges.
    if (!(await this.systemSettings.isMfaEnabled())) {
      throw new BadRequestException('MFA_DISABLED');
    }
    const adapter = this.getAdapter(input.type);
    const result = await adapter.enroll(input.userId);

    await this.audit({
      userId: input.userId,
      event: MfaAuditEventEnum.ENROLL,
      factorType: input.type,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return result;
  }

  /** Promote a PENDING factor to ACTIVE after the first successful verify. */
  async activate(factorId: string): Promise<void> {
    const updated = await this.factorModel
      .findByIdAndUpdate(
        factorId,
        { status: MfaFactorStatusEnum.ACTIVE },
        { returnDocument: 'after' },
      )
      .select('userId type')
      .lean();

    if (updated) {
      await this.notifyUser(
        String(updated.userId),
        'Two-factor authentication enabled',
        `You enabled ${updated.type} on your account.`,
        { event: 'mfa.factor.activated', factorType: updated.type, factorId: String(updated._id) },
      );
    }
  }

  private async notifyUser(
    userId: string,
    title: string,
    message: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.notificationService.publishNotification({
        channel: NotificationChannelEnum.TO_USER,
        payload: { userId, title, message, metadata },
        overrides: { email: true, push: true },
      });
    } catch (err) {
      this.logger.error('Failed to publish MFA notification', err as Error);
    }
  }

  async listFactors(userId: string): Promise<ListedFactor[]> {
    const rows = await this.factorModel
      .find({ userId })
      .select('type status isPreferred lastUsedAt')
      .lean();
    return rows.map((r) => ({
      id: String(r._id),
      type: r.type,
      status: r.status,
      isPreferred: r.isPreferred,
      lastUsedAt: r.lastUsedAt ?? null,
    }));
  }

  /**
   * True iff the user has at least one ACTIVE factor. Used by StepUpGuard to
   * decide whether step-up is enforceable — a user without any factor cannot
   * satisfy a step-up challenge, so gating their actions would lock them out.
   */
  async hasActiveFactor(userId: string): Promise<boolean> {
    const row = await this.factorModel
      .findOne({ userId, status: MfaFactorStatusEnum.ACTIVE })
      .select('_id')
      .lean();
    return !!row;
  }

  /** Whether the user can answer a step-up challenge — see `PolicyService`. */
  canAnswerStepUp(userId: string): Promise<boolean> {
    return this.policy.canAnswerStepUp(userId);
  }

  /**
   * Tear down another user's MFA so they can sign in again.
   *
   * Exists because a lost device was otherwise unrecoverable: backup codes
   * cannot answer a login challenge (they have no factor row), `/mfa/disable`
   * demands the factor that was lost, and a credential reset leaves the same
   * challenge standing. The only remaining path was to delete and recreate the
   * account.
   *
   * `actorId` is recorded on the audit row. The admin who can do this can also
   * reset the user's password, so the pair is a complete impersonation route —
   * the trail needs to name who used it.
   */
  async adminResetMfa(input: {
    userId: string;
    actorId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.disableAll({
      userId: input.userId,
      sessionId: null,
      ip: input.ip,
      userAgent: input.userAgent,
      auditEvent: MfaAuditEventEnum.ADMIN_RESET,
      auditMetadata: { actorId: input.actorId },
    });
  }

  async disableAll(input: DisableAllInput): Promise<void> {
    const factors = await this.factorModel.find({ userId: input.userId }).select('type').lean();
    for (const f of factors) {
      const adapter = this.registry.get(f.type);
      if (adapter) await adapter.revoke(String(f._id));
    }
    // Catch any factor whose adapter skipped DB cleanup or whose type is no
    // longer registered, plus orphaned secrets (no FK cascade in Mongo).
    const remaining = await this.factorModel.find({ userId: input.userId }).select('_id').lean();
    const remainingIds = remaining.map((r) => String(r._id));
    if (remainingIds.length > 0) {
      await this.secretModel.deleteMany({ factorId: { $in: remainingIds } });
    }
    await this.factorModel.deleteMany({ userId: input.userId });
    await this.backupCodeModel.deleteMany({ userId: input.userId });
    await this.trustedDevices.revokeAll(input.userId);

    // Invalidate outstanding sessions so an AAL2 JWT issued before teardown is
    // rejected (blocklist + better-auth session delete). Also drop this
    // session's MFA state snapshot so a cookie-cache refresh can't re-mint AAL2.
    await this.tokenService.invalidateAllUserSessions(input.userId);
    if (input.sessionId) {
      await this.sessions.revokeSessionState(input.sessionId);
    }

    await this.audit({
      userId: input.userId,
      event: input.auditEvent ?? MfaAuditEventEnum.DISABLE,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: input.auditMetadata,
    });

    const byAdmin = input.auditEvent === MfaAuditEventEnum.ADMIN_RESET;

    await this.notifyUser(
      input.userId,
      'Two-factor authentication disabled',
      byAdmin
        ? 'An administrator removed all MFA factors from your account. If you did not request this, contact them immediately.'
        : 'All MFA factors were removed from your account.',
      { event: byAdmin ? 'mfa.admin_reset' : 'mfa.disabled' },
    );
  }

  // ─── Challenge lifecycle ─────────────────────────────────────────────────

  /**
   * Open a challenge for the given factor. For factors that need a server-
   * initiated code (Email-OTP), the adapter's startChallenge fires here. For
   * TOTP, the challenge row only carries metadata (no payload hash).
   */
  async startChallenge(input: StartChallengeInput): Promise<ChallengeStarted> {
    const factor = await this.factorModel
      .findOne({ _id: input.factorId, userId: input.userId })
      .select('type status')
      .lean();
    if (!factor) throw new Error('Factor not found');

    // For login challenges the factor must be ACTIVE. For enroll_verify it can be PENDING.
    if (
      input.purpose !== MfaChallengePurposeEnum.ENROLL_VERIFY &&
      factor.status !== MfaFactorStatusEnum.ACTIVE
    ) {
      throw new Error('Factor is not active');
    }

    const adapter = this.getAdapter(factor.type);

    let payloadSalt: string | null = null;
    let payloadHash: string | null = null;
    let expiresAt: Date;

    if (adapter.startChallenge) {
      const user = await this.userModel.findById(input.userId).select('email firstName').lean();
      if (!user) throw new Error('User not found');

      const challenge = await adapter.startChallenge({
        factorId: String(factor._id),
        purpose: input.purpose,
        scope: input.scope,
        user: { id: input.userId, email: user.email ?? null, firstName: user.firstName },
      });
      payloadSalt = challenge.payloadSalt;
      payloadHash = challenge.payloadHash;
      expiresAt = challenge.expiresAt;
    } else {
      // TOTP / WebAuthn: no server-initiated challenge; expiry = max idle time
      // we'll allow the challenge ID to live before forcing a fresh start.
      const ttlMin =
        input.purpose === MfaChallengePurposeEnum.STEP_UP
          ? STEP_UP_CHALLENGE_TTL_MIN
          : LOGIN_CHALLENGE_TTL_MIN;
      expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);
    }

    const row = await this.challengeModel.create({
      userId: input.userId,
      factorType: factor.type,
      purpose: input.purpose,
      payloadHash,
      payloadSalt,
      scope: input.scope ?? null,
      context: input.sessionId ? { sessionId: input.sessionId } : null,
      expiresAt,
    });

    return {
      challengeId: String(row._id),
      factorType: factor.type,
      expiresAt,
    };
  }

  /**
   * Verify a code against an open challenge. On success, deletes the challenge
   * row (single-use). On failure, decrements `attemptsRemaining`; when it hits
   * zero, the row is deleted and the next attempt requires a fresh challenge.
   *
   * Returns the verified challenge metadata (purpose, scope, factorId) so
   * the caller can trigger the right side-effect (issue step-up token, complete
   * login, promote pending factor).
   */
  async verifyChallenge(input: VerifyChallengeInput): Promise<VerifyChallengeResult> {
    // `$inc` guarded by the filter makes the decrement the gate: the row only
    // matches while it is live and has budget, and the decrement is part of the
    // same matched write, so exactly one request can claim each attempt.
    // Per-user ceiling, before the challenge is touched. `attemptsRemaining`
    // bounds a single challenge; nothing stopped a caller starting a fresh one
    // after every wrong code, and the IP limiter fails open when Redis is down.
    const owner = await this.challengeModel
      .findById(input.challengeId)
      .select('userId')
      .lean<{ userId: string } | null>();
    if (owner) {
      const lockedFor = await this.attempts.lockoutRetryAfter(owner.userId);
      if (lockedFor !== null) {
        return { ok: false, reason: 'locked_out', retryAfter: lockedFor };
      }
    }

    const claimed = (await this.challengeModel
      .findOneAndUpdate(
        {
          _id: input.challengeId,
          attemptsRemaining: { $gt: 0 },
          expiresAt: { $gt: new Date() },
        },
        { $inc: { attemptsRemaining: -1 } },
        { returnDocument: 'after' },
      )
      .lean()) as ChallengeDoc | null;

    if (!claimed) {
      // Re-read to tell the three misses apart: the row may also have been
      // deleted between the update and now, which is itself "not_found".
      const existing = (await this.challengeModel
        .findById(input.challengeId)
        .lean()) as ChallengeDoc | null;
      if (!existing) return { ok: false, reason: 'not_found' };
      if (existing.expiresAt.getTime() <= Date.now()) {
        await this.challengeModel.deleteOne({ _id: existing._id });
        return { ok: false, reason: 'expired' };
      }
      await this.challengeModel.deleteOne({ _id: existing._id });
      return { ok: false, reason: 'attempts_exhausted' };
    }

    const challenge = claimed;

    const factor = await this.pickFactorForChallenge(challenge);
    if (!factor) {
      await this.challengeModel.deleteOne({ _id: challenge._id });
      return { ok: false, reason: 'not_found' };
    }

    const adapter = this.getAdapter(factor.type as MfaFactorTypeEnum);
    const ok = await adapter.verify({
      userId: challenge.userId,
      factorId: factor.id,
      code: input.code,
      challenge: {
        id: String(challenge._id),
        payloadSalt: challenge.payloadSalt ?? null,
        payloadHash: challenge.payloadHash ?? null,
      },
    });

    if (ok) {
      await this.attempts.clearFailures(challenge.userId);

      // Lost the race to consume this challenge — another request already
      // redeemed the same code. Report it as spent rather than issuing a
      // second proof for one verification.
      if (!(await this.recordSuccess(challenge, factor, input))) {
        return { ok: false, reason: 'not_found' };
      }
      const ctx = (challenge.context as ChallengeContext | null) ?? null;
      return {
        ok: true,
        userId: challenge.userId,
        factorId: factor.id,
        factorType: factor.type as MfaFactorTypeEnum,
        purpose: challenge.purpose,
        scope: challenge.scope ?? null,
        sessionId: ctx?.sessionId ?? null,
      };
    }

    // Purge only. Writing `attemptsRemaining` back would be an absolute write
    // of a value read after this request's own `$inc`, restoring a spent
    // attempt whenever two failures race.
    if (challenge.attemptsRemaining <= 0) {
      await this.challengeModel.deleteOne({ _id: challenge._id });
    }

    await this.attempts.recordFailure(challenge.userId);
    await this.audit({
      userId: challenge.userId,
      event: MfaAuditEventEnum.VERIFY_FAIL,
      factorType: factor.type as MfaFactorTypeEnum,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: 'invalid_code' };
  }

  /**
   * Find the factor row to verify against. With multiple rows of the same
   * type (e.g. user re-attempted enrollment), pick the one whose status
   * matches the challenge's purpose so we don't compare the wrong secret.
   */
  private async pickFactorForChallenge(
    challenge: ChallengeDoc,
  ): Promise<{ id: string; type: string; status: string; createdAt: Date } | null> {
    const rows = await this.factorModel
      .find({ userId: challenge.userId, type: challenge.factorType })
      .select('type status createdAt')
      .lean();
    if (rows.length === 0) return null;

    const candidates = rows.map((c) => ({
      id: String(c._id),
      type: c.type,
      status: c.status,
      createdAt: c.createdAt,
    }));

    const preferredStatus =
      challenge.purpose === MfaChallengePurposeEnum.ENROLL_VERIFY
        ? MfaFactorStatusEnum.PENDING
        : MfaFactorStatusEnum.ACTIVE;
    return (
      candidates
        .filter((c) => c.status === preferredStatus)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
      candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    );
  }

  /**
   * Consume the challenge and record the success. Returns false when another
   * request consumed it first.
   *
   * The delete is the gate: two requests carrying the same correct code can
   * both clear `adapter.verify`, so only the one that actually removed the row
   * may claim it. Otherwise one code buys both a login and a step-up token.
   */
  private async recordSuccess(
    challenge: ChallengeDoc,
    factor: { id: string; type: string; status: string },
    input: VerifyChallengeInput,
  ): Promise<boolean> {
    const { deletedCount } = await this.challengeModel.deleteOne({ _id: challenge._id });
    if (deletedCount !== 1) return false;

    if ((factor.status as MfaFactorStatusEnum) === MfaFactorStatusEnum.PENDING) {
      await this.activate(factor.id);
    }
    await this.audit({
      userId: challenge.userId,
      event: MfaAuditEventEnum.VERIFY_SUCCESS,
      factorType: factor.type as MfaFactorTypeEnum,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return true;
  }

  // ─── Audit helper ────────────────────────────────────────────────────────

  async audit(input: AuditInput): Promise<void> {
    try {
      await this.auditModel.create({
        userId: input.userId,
        event: input.event,
        factorType: input.factorType ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      // Audit must never block the primary flow. Log and move on.
      this.logger.warn(
        `Failed to write mfa_audit row for ${input.event}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ─── Login challenge orchestration ───────────────────────────────────────

  /**
   * Public-endpoint façade for `/api/mfa/login/challenge`. Validates the
   * caller's attempt token, looks up the user's matching active factor, and
   * opens a Login challenge. Throws if the token is invalid or no matching
   * factor is enrolled.
   */
  async startLoginChallenge(input: {
    attemptToken: string;
    factorType: MfaFactorTypeEnum;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ChallengeStarted> {
    const attempt = await this.attempts.verifyAttempt(input.attemptToken);
    if (!attempt) throw new UnauthorizedException({ error: 'invalid_attempt_token' });

    const factors = await this.listFactors(attempt.userId);
    const factor = factors.find(
      (f) => f.type === input.factorType && f.status === MfaFactorStatusEnum.ACTIVE,
    );
    if (!factor) throw new BadRequestException({ error: 'factor_not_enrolled' });

    return this.startChallenge({
      userId: attempt.userId,
      factorId: factor.id,
      purpose: MfaChallengePurposeEnum.LOGIN,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  /**
   * Authenticated-endpoint façade for `/api/mfa/challenge/start`. Rejects
   * `StepUp` purpose to keep step-up traffic on its dedicated endpoint
   * (`POST /mfa/step-up/start`), which carries the policy gate + sid binding.
   */
  async startAuthenticatedChallenge(
    input: StartChallengeInput & { purpose: MfaChallengePurposeEnum },
  ): Promise<ChallengeStarted> {
    if (input.purpose === MfaChallengePurposeEnum.STEP_UP) {
      throw new BadRequestException('Use POST /mfa/step-up/start for step-up challenges.');
    }
    return this.startChallenge(input);
  }

  /**
   * Public-endpoint façade for `/api/mfa/login/verify`. Validates the attempt
   * token, runs the challenge verification, emits the proof keyed on userId so
   * the client's next `/api/auth/sign-in/email` retry upgrades to AAL2, then
   * consumes the attempt token. Throws on invalid token, cross-user mismatch,
   * or verify failure.
   */
  async completeLoginChallenge(input: {
    attemptToken: string;
    challengeId: string;
    code: string;
    ip?: string | null;
    userAgent?: string | null;
    rememberDevice?: boolean;
  }): Promise<{ ok: true; trustedDevice?: { cookieValue: string; expiresAt: Date } }> {
    const attempt = await this.attempts.verifyAttempt(input.attemptToken);
    if (!attempt) throw new UnauthorizedException({ error: 'invalid_attempt_token' });

    const result = await this.verifyChallenge({
      challengeId: input.challengeId,
      code: input.code,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (!result.ok || result.userId !== attempt.userId) {
      throw new UnauthorizedException({
        error: 'mfa_verification_failed',
        reason: result.reason,
        ...(result.retryAfter !== undefined && { retryAfter: result.retryAfter }),
      });
    }
    if (result.factorType) {
      await this.attempts.emitProof(
        attempt.userId,
        result.factorType,
        factorTypeToAmr(result.factorType),
      );
    }
    await this.attempts.consumeAttempt(input.attemptToken);

    // Optionally register this browser as a trusted device (skips the LOGIN
    // challenge for 30 days; step-up unaffected). Eligibility is enforced by
    // the service (admin-powered roles are never eligible) — an ineligible
    // request simply gets no cookie.
    if (input.rememberDevice) {
      const registered = await this.trustedDevices.register({
        userId: attempt.userId,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
      });
      if (registered) {
        await this.audit({
          userId: attempt.userId,
          event: MfaAuditEventEnum.TRUST_DEVICE_ADDED,
          factorType: result.factorType ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        });
        return { ok: true, trustedDevice: registered };
      }
    }
    return { ok: true };
  }

  /**
   * Authenticated-endpoint façade for `/api/mfa/challenge/verify`. Wraps
   * `verifyChallenge` with the cross-user check and the post-EnrollVerify
   * `enrollment_required` flag drop, so the controller stays parse → call →
   * return.
   */
  async verifyChallengeAndClearEnrollmentFlag(input: {
    userId: string;
    sessionId?: string | null;
    challengeId: string;
    code: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{
    ok: true;
    factorType?: MfaFactorTypeEnum;
    purpose?: MfaChallengePurposeEnum;
  }> {
    const result = await this.verifyChallenge({
      challengeId: input.challengeId,
      code: input.code,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (!result.ok) {
      throw new UnauthorizedException({
        error: 'mfa_verification_failed',
        reason: result.reason,
        ...(result.retryAfter !== undefined && { retryAfter: result.retryAfter }),
      });
    }
    if (result.userId !== input.userId) {
      // Cross-user challenge use must never succeed.
      throw new UnauthorizedException({ error: 'mfa_verification_failed' });
    }
    // First successful enrollment for a mandatory user — drop the
    // `enrollment_required` flag from session state so the FE stops
    // redirecting back to /auth/mfa-setup. Best-effort; safe if no flag set.
    if (result.purpose === MfaChallengePurposeEnum.ENROLL_VERIFY && input.sessionId) {
      await this.sessions.clearEnrollmentRequired(input.sessionId);
    }
    return { ok: true, factorType: result.factorType, purpose: result.purpose };
  }

  /**
   * Drops `enrollment_required` from current session state so the proxy stops
   * redirecting to `/auth/mfa-setup` for the rest of this session. The flag
   * reapplies on next sign-in via `onLoginSessionCreating`, so postpone is
   * effectively "let me through this session, ask again next login".
   * No-op if no session state exists or the flag was never set.
   */
  async postponeEnrollment(input: { userId: string; sessionId: string }): Promise<{ ok: true }> {
    await this.sessions.clearEnrollmentRequired(input.sessionId);
    return { ok: true };
  }

  // ─── Backup-code orchestration ───────────────────────────────────────────

  /**
   * First-time backup-code issuance. Errors if any codes already exist —
   * caller must use `regenerateBackupCodes` (step-up gated) for re-issuance.
   */
  async issueInitialBackupCodes(input: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ codes: string[] }> {
    const remaining = await this.recovery.remaining(input.userId);
    if (remaining > 0) {
      throw new BadRequestException({ error: 'backup_codes_already_exist' });
    }
    const codes = await this.recovery.generate(input.userId);
    await this.audit({
      userId: input.userId,
      event: MfaAuditEventEnum.ENROLL,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { backup_codes_initial: true },
    });

    await this.notifyUser(
      input.userId,
      'MFA backup codes issued',
      'A set of MFA backup codes was generated for your account. Store them somewhere safe.',
      { event: 'mfa.backup_codes.issued' },
    );

    return { codes };
  }

  async regenerateBackupCodes(input: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ codes: string[] }> {
    const codes = await this.recovery.generate(input.userId);

    await this.audit({
      userId: input.userId,
      event: MfaAuditEventEnum.ENROLL,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { backup_codes_regenerated: true },
    });

    await this.notifyUser(
      input.userId,
      'MFA backup codes regenerated',
      'A new set of MFA backup codes was generated. Old codes are no longer valid.',
      { event: 'mfa.backup_codes.regenerated' },
    );

    return { codes };
  }

  async verifyBackupCode(input: {
    userId: string;
    code: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ ok: true; remaining: number }> {
    const ok = await this.recovery.verifyAndConsume(input.userId, input.code);
    if (!ok) throw new UnauthorizedException({ error: 'invalid_backup_code' });
    await this.audit({
      userId: input.userId,
      event: MfaAuditEventEnum.BACKUP_USED,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true, remaining: await this.recovery.remaining(input.userId) };
  }

  async backupCodesRemaining(userId: string): Promise<{ remaining: number }> {
    return { remaining: await this.recovery.remaining(userId) };
  }

  // ─── Trusted-device orchestration ────────────────────────────────────────

  listTrustedDevices(userId: string) {
    return this.trustedDevices.list(userId);
  }

  revokeTrustedDevice(input: { userId: string; deviceId: string }): Promise<void> {
    return this.trustedDevices.revoke(input);
  }
}

/**
 * Read one cookie off the web-standard `Request` Better Auth hands the hook.
 *
 * This is not an Express `Request` — the hook receives the raw fetch request,
 * so `cookie-parser` has not run and `req.cookies` does not exist here.
 */
function readCookie(request: Request | undefined, name: string): string | null {
  const header = request?.headers?.get?.('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function factorTypeToAmr(type: MfaFactorTypeEnum): AmrEnum[] {
  switch (type) {
    case MfaFactorTypeEnum.TOTP:
      return [AmrEnum.PWD, AmrEnum.TOTP];
    case MfaFactorTypeEnum.EMAIL_OTP:
      return [AmrEnum.PWD, AmrEnum.EMAIL_OTP];
    case MfaFactorTypeEnum.BACKUP_CODE:
      return [AmrEnum.PWD, AmrEnum.BACKUP_CODE];
    default:
      return [AmrEnum.PWD];
  }
}
