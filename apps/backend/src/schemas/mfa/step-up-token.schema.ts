import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';

/**
 * Mirrors drizzle `mfa.step_up_tokens`. Single-use step-up tokens, bound to
 * (user, session, scope). Issued by /api/mfa/step-up/verify, consumed by
 * StepUpGuard (atomic findOneAndDelete).
 *
 * Token row presence == validity. No "consumed" flag; on successful consume the
 * row is deleted so replay is impossible at the DB level.
 *
 * `jti` is the `jti` claim of the signed token (service assigns a randomUUID
 * string). It is a separate unique field — the document keeps its default
 * ObjectId `_id`. `sessionId` is the Better Auth session token (`sid` claim).
 */
@Schema({
  collection: 'mfa_step_up_tokens',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class MfaStepUpToken extends BaseSchema {
  /** `jti` claim of the signed step-up token. Consume keys on this, not `_id`. */
  @Prop({ type: String, required: true, unique: true })
  jti!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** Better Auth session token this step-up token is bound to. Token from a different session is rejected. */
  @Prop({ type: String, required: true })
  sessionId!: string;

  @Prop({ type: String, required: true })
  scope!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const MfaStepUpTokenSchema = SchemaFactory.createForClass(MfaStepUpToken);

// idx_mfa_step_up_session_scope
MfaStepUpTokenSchema.index({ userId: 1, sessionId: 1, scope: 1 });
// TTL — Mongo evicts the row once `expiresAt` passes (replaces the manual prune).
MfaStepUpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

MfaStepUpTokenSchema.loadClass(MfaStepUpToken);

export type MfaStepUpTokenModel = Model<MfaStepUpToken>;
