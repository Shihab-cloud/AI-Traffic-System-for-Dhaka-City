import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { AmrEnum } from 'src/shared/enums/auth.enum';
import { MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

/**
 * Mongo TTL replacement for backend-drizzle's Redis-backed login-attempt state.
 *
 * backend-mongoose has no Redis (Tier 2a decision). The two Redis keyspaces
 * (`mfa:login_attempt:{token}` and `mfa:proof:{userId}`) are folded into one
 * collection discriminated by `kind`:
 *   - kind='ATTEMPT' → key = attempt token (authorizes public /mfa/login/*)
 *   - kind='PROOF'   → key = userId         (consumed by onLoginSessionCreating)
 *   - kind='LOCKOUT' → key = userId         (per-user verification failures)
 *
 * `expiresAt` carries a TTL index (`expireAfterSeconds: 0`) so Mongo evicts
 * rows at their expiry, matching Redis EX semantics.
 */
export enum LoginAttemptKind {
  ATTEMPT = 'ATTEMPT',
  PROOF = 'PROOF',
  LOCKOUT = 'LOCKOUT',
}

@Schema({ collection: 'mfa_login_attempts', timestamps: true, versionKey: false })
export class LoginAttempt extends BaseSchema {
  @Prop({ type: String, required: true })
  kind!: LoginAttemptKind;

  /** attempt token for ATTEMPT rows, userId for PROOF and LOCKOUT rows. */
  @Prop({ type: String, required: true })
  key!: string;

  // ── ATTEMPT payload ──
  @Prop({ type: String, default: null })
  userId?: string | null;

  // ── PROOF payload ──
  @Prop({ type: String, default: null })
  factorType?: MfaFactorTypeEnum | null;

  @Prop({ type: Number, default: null })
  mfa_at?: number | null;

  @Prop({ type: [String], default: null })
  amr?: AmrEnum[] | null;

  // ── LOCKOUT payload ──
  /** Consecutive failed verifications inside the current window. */
  @Prop({ type: Number, default: null })
  failures?: number | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const LoginAttemptSchema = SchemaFactory.createForClass(LoginAttempt);

LoginAttemptSchema.index({ kind: 1, key: 1 }, { unique: true });
// TTL — Mongo evicts when `expiresAt` passes (matches Redis EX).
LoginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

LoginAttemptSchema.loadClass(LoginAttempt);

export type LoginAttemptModel = Model<LoginAttempt>;
