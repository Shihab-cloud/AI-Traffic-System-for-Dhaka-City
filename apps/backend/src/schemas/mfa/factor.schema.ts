import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { MfaFactorStatusEnum, MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

/**
 * Mirrors drizzle `mfa.factors`. Plain-String props for enums (no mongoose
 * enum validators — wire/validation parity is owned by the application layer).
 * `userId` stored as a plain String (ObjectId hex) to match the JWT `sub` and
 * keep cross-collection lookups uniform with the rest of backend-mongoose.
 */
@Schema({ collection: 'mfa_factors', timestamps: true, versionKey: false })
export class MfaFactor extends BaseSchema {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true })
  type!: MfaFactorTypeEnum;

  @Prop({ type: String, required: true, default: MfaFactorStatusEnum.PENDING })
  status!: MfaFactorStatusEnum;

  @Prop({ type: Boolean, required: true, default: false })
  isPreferred!: boolean;

  /**
   * Per-factor metadata: e.g. TOTP last accepted step (replay-window),
   * Email-OTP destination email override, WebAuthn credential id ref.
   * Never holds plaintext secrets — those go to mfa_factor_secrets.
   */
  @Prop({ type: Object })
  metadata?: Record<string, unknown> | null;

  @Prop({ type: Date })
  lastUsedAt?: Date | null;
}

export const MfaFactorSchema = SchemaFactory.createForClass(MfaFactor);

// idx_mfa_factors_user_type (idx_mfa_factors_user_id is covered by the `index` on userId above)
MfaFactorSchema.index({ userId: 1, type: 1 });

MfaFactorSchema.loadClass(MfaFactor);

export type MfaFactorModel = Model<MfaFactor>;
