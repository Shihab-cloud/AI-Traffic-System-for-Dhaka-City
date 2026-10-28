import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';

/**
 * Mirrors drizzle `mfa.factor_secrets`. Envelope-encrypted secret payload for a
 * factor. `factorId` is the unique key (1:1 with a factor row); on factor
 * delete the service deletes the matching secret (no FK cascade in Mongo).
 *
 * - kekId             : identifier of the KEK that wraps `dekCiphertext`.
 * - dekCiphertext     : DEK wrapped by KEK (KmsAdapter.wrap output).
 * - payloadCiphertext : payload encrypted by DEK using AES-256-GCM.
 * - payloadIv         : 12-byte GCM IV.
 * - payloadTag        : 16-byte GCM auth tag.
 * Never read except by FactorAdapter.verify.
 */
@Schema({ collection: 'mfa_factor_secrets', timestamps: true, versionKey: false })
export class MfaFactorSecret extends BaseSchema {
  @Prop({ type: String, required: true, unique: true })
  factorId!: string;

  @Prop({ type: String, required: true })
  kekId!: string;

  @Prop({ type: String, required: true })
  dekCiphertext!: string;

  @Prop({ type: String, required: true })
  payloadCiphertext!: string;

  @Prop({ type: String, required: true })
  payloadIv!: string;

  @Prop({ type: String, required: true })
  payloadTag!: string;
}

export const MfaFactorSecretSchema = SchemaFactory.createForClass(MfaFactorSecret);

MfaFactorSecretSchema.loadClass(MfaFactorSecret);

export type MfaFactorSecretModel = Model<MfaFactorSecret>;
