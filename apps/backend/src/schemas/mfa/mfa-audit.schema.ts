import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { MfaAuditEventEnum, MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

/**
 * Mirrors drizzle `mfa.mfa_audit`. Append-only MFA audit log. No reference to
 * the users collection — rows survive user deletion (forensic trail). `userId`
 * stays a plain String.
 */
@Schema({
  collection: 'mfa_audit',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class MfaAudit extends BaseSchema {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, index: true })
  event!: MfaAuditEventEnum;

  @Prop({ type: String, default: null })
  factorType?: MfaFactorTypeEnum | null;

  @Prop({ type: String, default: null })
  ip?: string | null;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  @Prop({ type: Object, default: null })
  metadata?: Record<string, unknown> | null;
}

export const MfaAuditSchema = SchemaFactory.createForClass(MfaAudit);

// idx_mfa_audit_created_at
MfaAuditSchema.index({ createdAt: 1 });

MfaAuditSchema.loadClass(MfaAudit);

export type MfaAuditModel = Model<MfaAudit>;
