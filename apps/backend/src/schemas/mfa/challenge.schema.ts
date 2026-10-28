import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { MfaChallengePurposeEnum, MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

/**
 * Mirrors drizzle `mfa.challenges`. Server-side challenge state — replaces
 * Better Auth's pre-verification twoFactorCookie pattern so no session/cookie
 * is ever issued before MFA is satisfied.
 *
 * Lifecycle: created on /api/mfa/challenge/start (login) or /api/mfa/step-up/start.
 * Consumed (deleted) on successful verify; soft-decremented on failed verify.
 */
@Schema({
  collection: 'mfa_challenges',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class MfaChallenge extends BaseSchema {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true })
  factorType!: MfaFactorTypeEnum;

  @Prop({ type: String, required: true })
  purpose!: MfaChallengePurposeEnum;

  /** Hashed expected payload (e.g. for Email OTP, the SHA-256 of `salt || code`). Null for TOTP (verified algorithmically). */
  @Prop({ type: String, default: null })
  payloadHash?: string | null;

  /** Per-OTP salt (for hashed-at-rest OTPs). Null for non-OTP factors. */
  @Prop({ type: String, default: null })
  payloadSalt?: string | null;

  @Prop({ type: Number, required: true, default: 5 })
  attemptsRemaining!: number;

  /** Action scope when purpose='STEP_UP' (e.g. 'RBAC:ROLE:CREATE'). Null otherwise. */
  @Prop({ type: String, default: null })
  scope?: string | null;

  /** Free-form context (e.g. session id at challenge time, ip, ua). */
  @Prop({ type: Object, default: null })
  context?: Record<string, unknown> | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const MfaChallengeSchema = SchemaFactory.createForClass(MfaChallenge);

// TTL — Mongo evicts the challenge once `expiresAt` passes (replaces the manual
// prune). verifyChallenge still enforces expiry inline since the sweep lags.
MfaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

MfaChallengeSchema.loadClass(MfaChallenge);

export type MfaChallengeModel = Model<MfaChallenge>;
