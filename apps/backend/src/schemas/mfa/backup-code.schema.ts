import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';

/**
 * Mirrors drizzle `mfa.backup_codes`. One row per issued backup code.
 */
@Schema({
  collection: 'mfa_backup_codes',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class MfaBackupCode extends BaseSchema {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /** bcrypt hash of the plaintext code (cost 12). Plaintext is shown to user once at issue and never persisted. */
  @Prop({ type: String, required: true })
  codeHash!: string;

  @Prop({ type: Date, default: null })
  consumedAt?: Date | null;
}

export const MfaBackupCodeSchema = SchemaFactory.createForClass(MfaBackupCode);

// idx_mfa_backup_codes_user_unconsumed
MfaBackupCodeSchema.index({ userId: 1, consumedAt: 1 });

MfaBackupCodeSchema.loadClass(MfaBackupCode);

export type MfaBackupCodeModel = Model<MfaBackupCode>;
