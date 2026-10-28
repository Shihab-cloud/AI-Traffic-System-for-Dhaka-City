import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';

/**
 * Mirrors drizzle `mfa.trusted_devices`. Cookie-bound trusted-device registry.
 * Cookie payload = signed (deviceId, exp) with a KEK-derived sub-key. Server
 * validates cookie + this row + revokedAt. Trust skips login MFA challenge
 * only; step-up always re-challenges.
 *
 * `deviceId` is the id embedded in the cookie (the service assigns a randomUUID
 * string). It is a separate unique field — the document keeps its default
 * ObjectId `_id`.
 */
@Schema({
  collection: 'mfa_trusted_devices',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class MfaTrustedDevice extends BaseSchema {
  /** Cookie-embedded device id. Lookups/revokes key on this, not `_id`. */
  @Prop({ type: String, required: true, unique: true })
  deviceId!: string;

  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /** SHA-256 of stable client signals (UA + accept headers + platform). Not user-controlled. */
  @Prop({ type: String, required: true })
  deviceFingerprintHash!: string;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  @Prop({ type: String, default: null })
  ipFirstSeen?: string | null;

  @Prop({ type: String, default: null })
  ipLastSeen?: string | null;

  @Prop({ type: Date, default: null })
  lastUsedAt?: Date | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;
}

export const MfaTrustedDeviceSchema = SchemaFactory.createForClass(MfaTrustedDevice);

// idx_mfa_trusted_devices_user_active
MfaTrustedDeviceSchema.index({ userId: 1, expiresAt: 1, revokedAt: 1 });

MfaTrustedDeviceSchema.loadClass(MfaTrustedDevice);

export type MfaTrustedDeviceModel = Model<MfaTrustedDevice>;
