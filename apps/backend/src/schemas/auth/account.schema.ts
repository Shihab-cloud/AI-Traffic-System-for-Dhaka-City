import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

/**
 * Better Auth's `accounts` collection, declared here **only so its indexes are
 * declared**.
 *
 * Nothing in this app reads or writes through this model: Better Auth owns the
 * collection and writes it through the raw driver, as do `TokenService` and
 * `ProvisioningService`. Mongoose validation therefore never runs on these
 * documents, and the fields below are a description of what Better Auth
 * stores, not a constraint on it.
 *
 * Registering it anyway is what lets Mongoose build the indexes on connect,
 * the same way every other schema in `src/schemas` gets its indexes — instead
 * of a `createIndex` call hung off a service's `onModuleInit`.
 */
@Schema({ collection: 'accounts', versionKey: false, strict: false })
export class Account {
  @Prop({ type: String, required: true })
  accountId!: string;

  /** `'credential'` for password accounts; the provider id for social ones. */
  @Prop({ type: String, required: true })
  providerId!: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** bcrypt hash — present on `credential` rows only. */
  @Prop({ type: String, default: null })
  password?: string | null;

  @Prop({ type: String, default: null })
  accessToken?: string | null;

  @Prop({ type: String, default: null })
  refreshToken?: string | null;

  @Prop({ type: String, default: null })
  idToken?: string | null;

  @Prop({ type: Date, default: null })
  accessTokenExpiresAt?: Date | null;

  @Prop({ type: Date, default: null })
  refreshTokenExpiresAt?: Date | null;

  @Prop({ type: String, default: null })
  scope?: string | null;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export const AccountSchema = SchemaFactory.createForClass(Account);

// Better Auth looks an account up by user, and both `TokenService` and
// `ProvisioningService` query `{ userId, providerId }` on every credential
// write. Mirrors `idx_accounts_user_id` on the drizzle backend.
AccountSchema.index({ userId: 1 });

/**
 * One credential row per user, enforced by the database.
 *
 * Better Auth declares no constraints on this collection, so two invite
 * redemptions racing each other both pass a "does one exist" read and both
 * insert; Better Auth then authenticates against whichever it reads first, and
 * nothing here knows to revoke the other. A read-then-insert cannot serialise
 * that on its own — only the index can.
 *
 * Partial, because social providers legitimately allow several rows per user.
 *
 * If the index fails to build, duplicate credential rows already exist for some
 * user and must be reconciled by hand; Mongoose surfaces that as an index error
 * on connect.
 */
AccountSchema.index(
  { userId: 1, providerId: 1 },
  {
    unique: true,
    name: 'uniq_credential_account_per_user',
    partialFilterExpression: { providerId: 'credential' },
  },
);

export type AccountModel = Model<Account>;
