import { randomBytes } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Queue } from 'bullmq';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';

import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { RoleHierarchyPolicy } from '../rbac/role-hierarchy.policy';
import { TokenService } from '../token/token.service';
import { ActivateAccountRequest } from 'src/lib/dto/request/activate.req';
import { BETTER_AUTH, type BetterAuthInstance } from 'src/lib/providers/better-auth.provider';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { BACKGROUND_JOB_QUEUE_NAMES, JOB_TYPES } from 'src/shared/enums/background-queue.enum';
import { UserStatusEnum } from 'src/shared/enums/status.enum';
import { hashPassword } from 'src/utils/password.util';

export interface MagicLinkInvitePayload {
  userId: string;
  email: string;
  firstName: string;
}

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: UserModel,
    @InjectConnection() private readonly connection: Connection,
    @Inject(BETTER_AUTH) private readonly betterAuth: BetterAuthInstance,
    @InjectQueue(BACKGROUND_JOB_QUEUE_NAMES.PROVISIONING_MAGIC_LINK)
    private readonly magicLinkQueue: Queue,
    private readonly configService: ConfigService,
    private readonly hierarchy: RoleHierarchyPolicy,
    private readonly tokenService: TokenService,
  ) {}

  // Native MongoDB Db handle backing better-auth's collections. Credentials
  // live in the `accounts` collection (mongodbAdapter, usePlural:true) — there
  // is no separate Mongoose model for it, matching how token.service.ts and the
  // better-auth provider reach it (mirrors backend-drizzle's direct `accounts`
  // table access in this module).
  private get db() {
    const db = this.connection.db;
    if (!db) throw new Error('Mongoose connection is not established (connection.db is undefined)');
    return db;
  }

  // ─── Activation ────────────────────────────────────────────────────────────

  /**
   * Completes account activation for an admin-provisioned user in one step.
   *
   * Required preconditions:
   * - Authenticated session
   * - `users.mustResetPassword === true` for this user
   *
   * Performs:
   * - Hashes the new password and replaces the temp password on the credential account
   * - If `dto.email` is supplied:
   *     - Validates unique against other users
   *     - Writes `users.email` with `emailVerified=false`
   *     - Fires (best-effort, off the response path) a verification email via
   *       Better Auth — the address only becomes a trusted recovery channel
   *       once the user clicks the link (see `sendResetPassword` gate)
   * - The supplied email is REQUIRED for users who don't already have one on
   *   file. Users carrying an email already (e.g. magic-link onboarding) may
   *   omit it or pass the same value through.
   * - Clears `mustResetPassword` and `pendingTempPassword`
   * - Flips `status` from `INVITED` → `Active` (no-op if already Active)
   */
  async activate(caller: CurrentUser, dto: ActivateAccountRequest): Promise<{ ok: true }> {
    if (!caller.activation_required) {
      throw new ForbiddenException('ACTIVATION_NOT_REQUIRED');
    }

    const user = await this.userModel
      .findById(caller.id)
      .select('email emailVerified mustResetPassword status')
      .lean();

    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.mustResetPassword) {
      // Defensive — JWT and DB disagree (token cached, user already activated).
      throw new ForbiddenException('ACTIVATION_NOT_REQUIRED');
    }

    // Email handling: an emailless user MUST supply an address; an
    // already-emailed user may omit it (or pass through the same value).
    const submittedEmail = dto.email;
    const emailChanged = submittedEmail !== undefined && submittedEmail !== user.email;

    if (!user.email && !submittedEmail) {
      throw new BadRequestException('EMAIL_REQUIRED');
    }
    if (emailChanged) {
      const taken = await this.userModel
        .findOne({ email: submittedEmail, _id: { $ne: caller.id } })
        .select('_id')
        .lean();
      if (taken) {
        throw new ConflictException('Email already in use');
      }
    }

    const userId = String(caller.id);

    // Credential account lives in better-auth's `accounts` collection.
    // `accounts.userId` is stored as an ObjectId (see writeCredentialAccount) —
    // querying with the string form never matches.
    const credentialAccount = await this.db
      .collection('accounts')
      .findOne({ userId: new ObjectId(userId), providerId: 'credential' });

    if (!credentialAccount) {
      throw new BadRequestException(
        'No credential account found — cannot activate (contact an administrator)',
      );
    }

    const newPasswordHash = await hashPassword(dto.newPassword);

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db
          .collection('accounts')
          .updateOne(
            { _id: credentialAccount._id },
            { $set: { password: newPasswordHash, updatedAt: new Date() } },
            { session },
          );

        const userUpdate: Record<string, unknown> = {
          mustResetPassword: false,
          // Emailless users carry their admin-issued temp password as plaintext
          // on `users.pendingTempPassword`. Once they've activated, the plaintext
          // is no longer needed (and shouldn't linger) — clear unconditionally.
          // Users who came via the email/magic-link path have it null already.
          pendingTempPassword: null,
        };
        if (emailChanged) {
          userUpdate.email = submittedEmail;
          userUpdate.emailVerified = false;
        }
        if (user.status === UserStatusEnum.INVITED) userUpdate.status = UserStatusEnum.ACTIVE;

        await this.userModel.updateOne({ _id: caller.id }, { $set: userUpdate }, { session });
      });
    } finally {
      await session.endSession();
    }

    // The temp password is spent. Anything it authorised — a session someone
    // else opened with an intercepted temp password, and any device it marked
    // trusted — goes with it. The activating user signs in again with the
    // password they just chose.
    await this.tokenService.onCredentialChanged(userId);

    // Fire-and-forget the verification email when the address is new or
    // hasn't yet been verified. Failures are logged but never block the
    // response — the FE banner offers a "Resend" affordance if the user
    // doesn't receive it.
    const verificationTarget =
      emailChanged && submittedEmail
        ? submittedEmail
        : !user.emailVerified && user.email
          ? user.email
          : null;

    if (verificationTarget) {
      void this.dispatchVerificationEmail(verificationTarget);
    }

    // Side note: the current JWT still carries `activation_required: true` until
    // it expires. FE should refresh the session after a successful activation
    // (calling `authClient.getSession()` re-renders the customSession block which
    // now reads mustResetPassword=false).
    return { ok: true };
  }

  /**
   * Best-effort dispatch. Better Auth issues the verification token + stores it
   * on the `verifications` collection, then invokes the `sendVerificationEmail`
   * callback in `better-auth.ts` which calls `MailService`. Errors are
   * swallowed (logged) so they never break the activate response — the user
   * can always re-send from the in-app banner.
   *
   * `callbackURL` points at the public `/auth/email-verified` page so the
   * recipient sees an explicit success / failure confirmation regardless of
   * whether they're signed in. Landing on `/dashboard` directly silently
   * bounces unauthenticated users to `/signin` with no feedback that the
   * verification actually happened.
   */
  private async dispatchVerificationEmail(email: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    try {
      await this.betterAuth.auth.api.sendVerificationEmail({
        body: { email, callbackURL: `${frontendUrl}/auth/email-verified` },
        headers: new Headers(),
      });
    } catch (err) {
      this.logger.warn(
        `dispatchVerificationEmail: failed for ${email} — ${(err as Error).message}`,
      );
    }
  }

  /**
   * Resend a verification email for the caller's own address. Caller must
   * already have an email on file; if it's already verified, returns 200
   * without sending (caller has no work to do).
   */
  async resendOwnVerificationEmail(caller: CurrentUser): Promise<{ ok: true }> {
    const user = await this.userModel.findById(caller.id).select('email emailVerified').lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.email) {
      throw new BadRequestException('EMAIL_NOT_SET');
    }
    if (user.emailVerified) {
      return { ok: true };
    }
    await this.dispatchVerificationEmail(user.email);
    return { ok: true };
  }

  // ─── Credentials (emailless admin-issued temp passwords) ───────────────────

  /**
   * Lists users whose plaintext temp password is still pending distribution.
   *
   * Scoped to targets the caller outranks: these rows are usable sign-in
   * credentials, so an unscoped listing would let any holder of this
   * permission sign in as an account ranked above them.
   */
  async listPendingCredentials(caller: CurrentUser) {
    const filter: Record<string, unknown> = {
      pendingTempPassword: { $ne: null },
      // emailless users only — mirrors drizzle's `isNull(users.email)`. Email
      // is optional on the user schema; the $or covers both a missing key
      // (emailless create paths omit it) and an explicit null.
      $or: [{ email: { $exists: false } }, { email: null }],
    };

    const rows = await this.userModel
      .find(filter)
      .select('name username pendingTempPassword createdAt roleId')
      .sort({ createdAt: -1 })
      .lean();

    // Filter after the query rather than joining ranks into it: the row count
    // here is bounded by "provisioned but not yet activated", so the simpler
    // shape costs nothing and keeps one rank rule in one place.
    const visible = await this.filterToOutrankedTargets(caller, rows);

    return visible.map((r) => ({
      userId: String(r._id),
      name: r.name,
      username: r.username ?? '',
      tempPassword: r.pendingTempPassword ?? '',
      createdAt: r.createdAt,
    }));
  }

  /** Keeps only the rows whose owner the caller outranks. */
  private async filterToOutrankedTargets<T extends { _id: unknown }>(
    caller: CurrentUser,
    rows: T[],
  ): Promise<T[]> {
    const kept: T[] = [];
    for (const row of rows) {
      try {
        await this.hierarchy.assertOutranksUser(caller, String(row._id));
        kept.push(row);
      } catch {
        // Outranked or self — omit rather than fail the whole listing.
      }
    }
    return kept;
  }

  /**
   * Issues a fresh temp password for one user. Used when an admin needs to
   * reissue (lost the printed page, user never received it, etc.).
   *
   * Only valid for emailless, not-yet-activated users — fails loudly otherwise.
   */
  async regenerateCredentials(userId: string, caller: CurrentUser) {
    // Rank check, matching `resetCredentials` in user-management: this returns
    // the new plaintext, so without it any `UPDATE:USER` holder could rotate a
    // super-admin's credential and read it.
    await this.hierarchy.assertOutranksUser(caller, userId);

    const target = await this.userModel.findById(userId).select('email mustResetPassword').lean();
    if (!target) throw new NotFoundException('User not found');
    if (target.email) {
      throw new BadRequestException(
        'CREDENTIALS_NOT_APPLICABLE: User has an email; use the magic-link / reset-password flow instead',
      );
    }
    if (!target.mustResetPassword) {
      throw new BadRequestException(
        'CREDENTIALS_NOT_APPLICABLE: User has already activated; password rotation goes through the standard reset flow',
      );
    }

    const tempPassword = randomBytes(9).toString('base64url');
    const newHash = await hashPassword(tempPassword);

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // `accounts.userId` is an ObjectId reference (see writeCredentialAccount);
        // a string here never matches and would insert an orphan duplicate that
        // better-auth ignores — the rotated password would silently never apply.
        const existing = await this.db
          .collection('accounts')
          .findOne({ userId: new ObjectId(userId), providerId: 'credential' }, { session });

        if (existing) {
          await this.db
            .collection('accounts')
            .updateOne(
              { _id: existing._id },
              { $set: { password: newHash, updatedAt: new Date() } },
              { session },
            );
        } else {
          await this.db.collection('accounts').insertOne(
            {
              accountId: userId,
              providerId: 'credential',
              userId: new ObjectId(userId),
              password: newHash,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            { session },
          );
        }

        await this.userModel.updateOne(
          { _id: userId },
          { $set: { pendingTempPassword: tempPassword } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    return { userId, tempPassword };
  }

  // ─── Magic-link invites (admin-provisioned users with email) ──────────────

  /**
   * Enqueues a magic-link invite for an admin-provisioned user who has an email.
   * Idempotent on userId: re-running provisioning for an already-invited user
   * won't enqueue a second invite.
   */
  async queueMagicLinkInvite(payload: MagicLinkInvitePayload): Promise<void> {
    await this.magicLinkQueue.add(
      JOB_TYPES[BACKGROUND_JOB_QUEUE_NAMES.PROVISIONING_MAGIC_LINK].SEND_MAGIC_LINK,
      payload,
      {
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 5000 },
        jobId: `magic-link-${payload.userId}`,
      },
    );
  }
}
