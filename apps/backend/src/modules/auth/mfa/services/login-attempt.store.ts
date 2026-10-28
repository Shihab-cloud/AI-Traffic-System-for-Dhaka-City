import { randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import {
  LoginAttempt,
  LoginAttemptKind,
  LoginAttemptModel,
} from 'src/schemas/mfa/login-attempt.schema';
import { AmrEnum } from 'src/shared/enums/auth.enum';
import { MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

const PROOF_TTL_SEC = 2 * 60;
const ATTEMPT_TTL_SEC = 10 * 60;

/**
 * Per-user verification ceiling.
 *
 * The IP rate limiter is the only other bound, and it fails *open* when Redis
 * is unreachable — so without this a Redis outage means unlimited code guessing
 * for anyone holding the password, and a distributed caller was never bounded
 * per account at all. A TOTP code is six digits; 10 tries per 15 minutes keeps
 * the odds negligible while staying clear of a real person fat-fingering a code
 * on a phone.
 */
const LOCKOUT_MAX_FAILURES = 10;
const LOCKOUT_WINDOW_SEC = 15 * 60;

export interface ProofPayload {
  factorType: MfaFactorTypeEnum;
  mfa_at: number;
  amr: AmrEnum[];
}

/**
 * LoginAttemptStore — Mongo TTL I/O for the public-endpoint side of the MFA
 * dance, via the `mfa_login_attempts` TTL collection.
 *
 *   - **Attempt token** authorizes /api/mfa/login/* without a session/JWT, since
 *     those endpoints fire between password-verified and session-created. Keyed
 *     on a 32-byte random token, value = `{ userId }`.
 *   - **Proof** is what `MfaService.onLoginSessionCreating` consumes to upgrade
 *     a session to AAL2. Keyed by userId, narrow 2 min TTL.
 *
 * Held private inside `MfaModule`. External callers go through `MfaService`,
 * which delegates here.
 */
@Injectable()
export class LoginAttemptStore {
  constructor(@InjectModel(LoginAttempt.name) private readonly model: LoginAttemptModel) {}

  // ─── Attempt token ───────────────────────────────────────────────────────

  async mintAttempt(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.model.updateOne(
      { kind: LoginAttemptKind.ATTEMPT, key: token },
      {
        kind: LoginAttemptKind.ATTEMPT,
        key: token,
        userId,
        expiresAt: new Date(Date.now() + ATTEMPT_TTL_SEC * 1000),
      },
      { upsert: true },
    );
    return token;
  }

  async verifyAttempt(token: string): Promise<{ userId: string } | null> {
    if (!token) return null;
    const row = await this.model.findOne({ kind: LoginAttemptKind.ATTEMPT, key: token }).lean();
    // Mongo's TTL sweep is best-effort (up to ~60s lag); enforce expiry here.
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    if (typeof row.userId !== 'string') return null;
    return { userId: row.userId };
  }

  async consumeAttempt(token: string): Promise<void> {
    await this.model.deleteOne({ kind: LoginAttemptKind.ATTEMPT, key: token });
  }

  // ─── Proof ───────────────────────────────────────────────────────────────

  async emitProof(userId: string, factorType: MfaFactorTypeEnum, amr: AmrEnum[]): Promise<void> {
    await this.model.updateOne(
      { kind: LoginAttemptKind.PROOF, key: userId },
      {
        kind: LoginAttemptKind.PROOF,
        key: userId,
        factorType,
        mfa_at: Math.floor(Date.now() / 1000),
        amr,
        expiresAt: new Date(Date.now() + PROOF_TTL_SEC * 1000),
      },
      { upsert: true },
    );
  }

  // ─── Per-user lockout ────────────────────────────────────────────────────

  /**
   * Count one failed verification, and report whether the user is now locked.
   *
   * `$inc` with upsert so concurrent failures cannot each read the same count
   * and write back the same total — the decrement-race the challenge's own
   * `attemptsRemaining` had.
   */
  async recordFailure(userId: string): Promise<{ locked: boolean; failures: number }> {
    const row = await this.model
      .findOneAndUpdate(
        { kind: LoginAttemptKind.LOCKOUT, key: userId },
        {
          $inc: { failures: 1 },
          // Fixed window: the expiry is only stamped when the row is created,
          // so a steady trickle of guesses cannot hold the window open forever.
          $setOnInsert: {
            kind: LoginAttemptKind.LOCKOUT,
            key: userId,
            expiresAt: new Date(Date.now() + LOCKOUT_WINDOW_SEC * 1000),
          },
        },
        { upsert: true, returnDocument: 'after' },
      )
      .lean();

    const failures = row?.failures ?? 1;
    return { locked: failures >= LOCKOUT_MAX_FAILURES, failures };
  }

  /** Seconds until the lockout lifts, or null when the user is not locked. */
  async lockoutRetryAfter(userId: string): Promise<number | null> {
    const row = await this.model.findOne({ kind: LoginAttemptKind.LOCKOUT, key: userId }).lean();
    if (!row || (row.failures ?? 0) < LOCKOUT_MAX_FAILURES) return null;

    const remainingMs = row.expiresAt.getTime() - Date.now();
    // Mongo's TTL sweep lags by up to ~60s, so an elapsed window is treated as
    // clear here rather than waiting for the row to actually disappear.
    if (remainingMs <= 0) return null;
    return Math.ceil(remainingMs / 1000);
  }

  /** Clear the counter — called on a successful verification. */
  async clearFailures(userId: string): Promise<void> {
    await this.model.deleteOne({ kind: LoginAttemptKind.LOCKOUT, key: userId });
  }

  /**
   * Read-then-delete a proof row.
   *
   * Keyed on userId, not on the attempt token that earned it — so anyone who
   * already has the password can race the user and claim the proof they just
   * produced, winning an AAL2 session. That is an accepted trade-off, not an
   * oversight: binding the proof to the attempt token would require the client
   * to send that token back on the sign-in retry, and the proof is consumed
   * inside Better Auth's session hook, which does not see it.
   *
   * The 2-minute TTL is what keeps the window narrow, and `findOneAndDelete`
   * makes the read+delete atomic so only one caller can ever redeem a proof.
   * Shorten the TTL before widening anything else here.
   */
  async consumeProof(userId: string): Promise<ProofPayload | null> {
    const row = await this.model
      .findOneAndDelete({ kind: LoginAttemptKind.PROOF, key: userId })
      .lean();
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    if (
      typeof row.factorType !== 'string' ||
      typeof row.mfa_at !== 'number' ||
      !Array.isArray(row.amr)
    ) {
      return null;
    }
    return {
      factorType: row.factorType,
      mfa_at: row.mfa_at,
      amr: row.amr,
    };
  }
}
