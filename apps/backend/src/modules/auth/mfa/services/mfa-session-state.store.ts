import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import {
  MfaSessionState,
  MfaSessionStateKind,
  MfaSessionStateModel,
} from 'src/schemas/mfa/mfa-session-state.schema';
import { AmrEnum } from 'src/shared/enums/auth.enum';
import { SESSION_EXPIRY_SECONDS } from 'src/lib/auth/session.constants';

const PENDING_TTL_SEC = 30; // bridges session.create.before → session.create.after
// Sized against the Better Auth session lifetime, and — crucially — refreshed
// on every read (see `getSessionState`).
//
// A fixed TTL is not enough on its own, because Better Auth sessions are
// rolling: once `expiresAt - expiresIn + updateAge <= now` it calls
// `internalAdapter.updateSession` and pushes `expiresAt` forward on the *same*
// session id. A user who signs in and browses daily therefore keeps one session
// well past `SESSION_EXPIRY_SECONDS`, while this row — written once at session
// creation — would expire underneath it. `enrichJwtPayload` then returns null,
// `aal` silently drops to 1, and the user gets a surprise step-up prompt.
//
// Refreshing on read ties the row's lifetime to session *use*, which is the
// same thing `updateAge` ties the session's own lifetime to.
const SESSION_STATE_TTL_SEC = SESSION_EXPIRY_SECONDS;

export interface PendingState {
  aal: 1 | 2;
  amr: AmrEnum[];
  mfa_at?: number;
  /**
   * Set when a mandatory-enrollment user signs in within the grace period
   * without an active factor. Frontend uses it to redirect to /auth/mfa-setup.
   */
  enrollment_required?: boolean;
}

/**
 * MfaSessionStateStore — Mongo TTL I/O for the BA-hook side of the MFA dance.
 * backend-drizzle backs this with Redis; backend-mongoose has no Redis
 * (Tier 2a decision), so this uses the `mfa_session_state` TTL collection.
 *
 *   - **Pending state** bridges `session.create.before` → `session.create.after`,
 *     keyed by userId. Short 30 s TTL because it's consumed in the same request.
 *   - **Session state** is the AAL/amr/mfa_at snapshot keyed by sessionId. Read
 *     by `enrichJwtPayload` and `customSession`; written once per session.
 *
 * Held private inside `MfaModule`.
 */
@Injectable()
export class MfaSessionStateStore {
  constructor(@InjectModel(MfaSessionState.name) private readonly model: MfaSessionStateModel) {}

  // ─── Pending (per-user, ephemeral) ───────────────────────────────────────

  async setPending(userId: string, state: PendingState): Promise<void> {
    await this.upsert(MfaSessionStateKind.PENDING, userId, state, PENDING_TTL_SEC);
  }

  async getPending(userId: string): Promise<PendingState | null> {
    return this.read(MfaSessionStateKind.PENDING, userId);
  }

  async clearPending(userId: string): Promise<void> {
    await this.model.deleteOne({ kind: MfaSessionStateKind.PENDING, key: userId });
  }

  // ─── Session (per-sessionId, durable for session lifetime) ───────────────

  async setSessionState(sessionId: string, state: PendingState): Promise<void> {
    await this.upsert(MfaSessionStateKind.SESSION, sessionId, state, SESSION_STATE_TTL_SEC);
  }

  async getSessionState(sessionId: string): Promise<PendingState | null> {
    return this.read(MfaSessionStateKind.SESSION, sessionId, SESSION_STATE_TTL_SEC);
  }

  async revokeSessionState(sessionId: string): Promise<void> {
    await this.model.deleteOne({ kind: MfaSessionStateKind.SESSION, key: sessionId });
  }

  /**
   * Drop the `enrollment_required` flag from an existing session state. Called
   * after a mandatory user finishes enrollment so the dashboard layout stops
   * bouncing them back to /auth/mfa-setup. Subsequent JWTs / customSession
   * reads no longer carry the flag.
   */
  async clearEnrollmentRequired(sessionId: string): Promise<void> {
    const existing = await this.getSessionState(sessionId);
    if (!existing) return;
    if (!existing.enrollment_required) return;
    delete existing.enrollment_required;
    await this.setSessionState(sessionId, existing);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async upsert(
    kind: MfaSessionStateKind,
    key: string,
    state: PendingState,
    ttlSec: number,
  ): Promise<void> {
    await this.model.updateOne(
      { kind, key },
      {
        kind,
        key,
        aal: state.aal,
        amr: state.amr,
        mfa_at: state.mfa_at ?? null,
        enrollment_required: state.enrollment_required ?? null,
        expiresAt: new Date(Date.now() + ttlSec * 1000),
      },
      { upsert: true },
    );
  }

  /**
   * @param renewTtlSec When given, a live row has its `expiresAt` pushed out by
   *   this many seconds — the read itself is the proof the session is still in
   *   use. Omitted for pending state, which is consumed within one request.
   */
  private async read(
    kind: MfaSessionStateKind,
    key: string,
    renewTtlSec?: number,
  ): Promise<PendingState | null> {
    const row = await this.model.findOne({ kind, key }).lean();
    // Mongo's TTL sweep is best-effort (up to ~60s lag); enforce expiry here.
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;

    if (renewTtlSec !== undefined) {
      await this.model.updateOne(
        { kind, key },
        { expiresAt: new Date(Date.now() + renewTtlSec * 1000) },
      );
    }

    if (row.aal !== 1 && row.aal !== 2) return null;
    if (!Array.isArray(row.amr)) return null;
    const state: PendingState = { aal: row.aal, amr: row.amr };
    if (typeof row.mfa_at === 'number') state.mfa_at = row.mfa_at;
    if (row.enrollment_required) state.enrollment_required = true;
    return state;
  }
}
