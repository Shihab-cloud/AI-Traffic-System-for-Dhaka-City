import paginate from 'mongoose-paginate-v2';

import { Model, PaginateModel } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import {
  CLOCK_SKEW_MARGIN_SECONDS,
  MAX_JWT_LIFETIME_SECONDS,
} from '../../shared/constants/jwt.constants';

@Schema({ timestamps: true, versionKey: false })
export class InvalidatedToken extends BaseSchema {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  invalidatedAt!: Date;
}

export const InvalidatedTokenSchema = SchemaFactory.createForClass(InvalidatedToken);

// A blocklist row outlives every JWT that could still match it, then Mongo
// evicts it. Sized from MAX_JWT_LIFETIME_SECONDS — the ceiling `env.schema.ts`
// enforces on JWT_EXPIRY_SECONDS — rather than the configured lifetime, because
// this module is evaluated before ConfigModule has loaded `.env`: reading
// process.env here would silently use the fallback and expire rows while the
// tokens they revoke are still valid. Over-retention is only disk.
const BLOCKLIST_TTL_SECONDS = MAX_JWT_LIFETIME_SECONDS + CLOCK_SKEW_MARGIN_SECONDS;
InvalidatedTokenSchema.index({ invalidatedAt: 1 }, { expireAfterSeconds: BLOCKLIST_TTL_SECONDS });

// AuthGuard runs `{ userId, invalidatedAt: { $gt: iat } }` on every
// authenticated request. Without this the TTL index alone forces a scan of the
// whole `invalidatedAt > iat` range, which during a mass invalidation holds
// every holder of a role at once.
InvalidatedTokenSchema.index({ userId: 1, invalidatedAt: -1 });

InvalidatedTokenSchema.plugin(paginate);

InvalidatedTokenSchema.loadClass(InvalidatedToken);

export interface InvalidatedTokenModel
  extends Model<InvalidatedToken>, PaginateModel<InvalidatedToken> {}
