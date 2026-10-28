import * as bcrypt from 'bcrypt';
import paginate from 'mongoose-paginate-v2';
import aggregatePaginate from 'mongoose-aggregate-paginate-v2';

import {
  AggregatePaginateModel,
  Model,
  Schema as MongooseSchema,
  PaginateModel,
  Types,
} from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { Role } from './role.schema';
import { Type } from 'class-transformer';
import { UserStatusEnum } from 'src/shared/enums/status.enum';
import { registerSearchFields } from 'src/utils/search-registry';

@Schema({
  versionKey: false,
  timestamps: true,
  // Surface the `role` virtual (populated from roleId) when serialized, so
  // responses carry a nested `role` object like drizzle's UserResponse.
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class User extends BaseSchema {
  get fullName(): string {
    return [this.firstName, this.lastName].filter(Boolean).join(' ') || '';
  }

  // Stored (not derived): better-auth's user model requires a real `name`
  // column it reads/writes. Populated as `${firstName} ${lastName}` on every
  // create/update path. Defaults to '' so reads never break.
  @Prop({ type: String, default: '' })
  name!: string;

  @Prop({ type: String })
  firstName!: string;

  @Prop({ type: String })
  lastName!: string;

  // Optional, uniquely indexed only when present. Admin-provisioned users may
  // have no email (mirrors drizzle, which allows a null `email`). Uniqueness is
  // enforced via a PARTIAL index (declared below) gated on `email` being a
  // string — NOT a sparse-unique index, because `sparse` does NOT exempt an
  // explicit `null` value, so two `{ email: null }` users would collide.
  // Emailless create paths therefore OMIT the key entirely (never write null).
  // The credentials / pending-temp-password flow depends on this.
  @Prop({ type: String, required: false })
  email?: string;

  // Required by better-auth's user model (Step 2 adopts better-auth via the
  // mongodbAdapter). Safe to add now; not yet wired.
  @Prop({ type: Boolean, required: true, default: false })
  emailVerified!: boolean;

  // Uniqueness is enforced case-insensitively via the collated index declared
  // below (UserSchema.index on `username`) — NOT via a plain `unique: true`,
  // which would be case-sensitive and let `Alice`/`alice` coexist. This mirrors
  // drizzle's `unique(lower(username))`. `displayUsername` preserves casing.
  @Prop({ type: String })
  username?: string;

  // Preserves original casing of `username` for display.
  @Prop({ type: String })
  displayUsername?: string;

  @Prop({ type: String })
  password!: string;

  @Prop({ type: Boolean, required: true, default: false })
  mustResetPassword!: boolean;

  // Plaintext one-time credential surfaced to admins when an admin creates a
  // user without an email. Cleared on first successful activation, or when an
  // admin regenerates them. Never set for users who have an email.
  @Prop({ type: String })
  pendingTempPassword?: string;

  // Stored role FK (named `roleId` to match better-auth's config + drizzle).
  // Not exposed directly in responses — the `role` virtual below hydrates the
  // nested Role object that UserResponse serializes.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Role.name,
    required: false,
  })
  roleId!: Types.ObjectId;

  // Populate-only virtual (see UserSchema.virtual('role') below). Hydrated by
  // `.populate('role')`; serialized as the nested `role` object in responses.
  @Type(() => Role)
  role?: Role;

  // profile picture URL
  @Prop({ type: String })
  image?: string;

  @Prop({ type: String })
  phone?: string;

  @Prop({ type: String, default: UserStatusEnum.ACTIVE })
  status!: UserStatusEnum;

  async validatePassword(password: string): Promise<boolean> {
    return await bcrypt.compare(password, this.password);
  }
}

export const UserSchema = SchemaFactory.createForClass(User);

// Case-insensitive unique index on `username` (mirrors drizzle's
// `unique(lower(username))`). collation strength:2 ignores case so `Alice` and
// `alice` collide; sparse so emailless/usernameless users don't conflict on a
// missing value. `assertUsernameAvailable` queries with the SAME collation so
// the app-level pre-check matches what the index enforces.
UserSchema.index(
  { username: 1 },
  { unique: true, sparse: true, collation: { locale: 'en', strength: 2 } },
);

// Partial unique index on `email`: enforced only for documents where `email`
// is a string. Unlike a sparse-unique index, this exempts BOTH missing keys and
// explicit nulls, so any number of emailless users can coexist while real
// emails stay unique.
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);

// `roleId` is queried to find every holder of a role — on each RBAC role change
// (to revoke their sessions) and by the support module's admin lookup. Without
// this it is a collection scan of every user.
UserSchema.index({ roleId: 1 });

// Virtual `role`: hydrates the full Role from the stored `roleId` FK on
// `.populate('role')`. Mirrors drizzle's nested `role` in UserResponse;
// `roleId` stays the internal stored FK and is not exposed in responses.
UserSchema.virtual('role', {
  ref: Role.name,
  localField: 'roleId',
  foreignField: '_id',
  justOne: true,
});

UserSchema.statics.isEmailTaken = async function (
  email: string,
  excludeUserId?: string,
): Promise<boolean> {
  const user = await (this as UserModel).findOne({
    email,
    _id: {
      $ne: excludeUserId,
    },
  });
  return !!user;
};

// Mongoose 9: async middleware no longer receives (or needs) a `next` callback —
// resolution of the returned promise continues the chain.
UserSchema.pre('save', async function () {
  if (this.password && this.isModified('password')) {
    const hashedPassword = await bcrypt.hash(this.password, 10);
    this.password = hashedPassword;
  }
});

UserSchema.plugin(paginate);
UserSchema.plugin(aggregatePaginate);

UserSchema.loadClass(User);

// `?search=` matches identity/contact fields ONLY — deliberately excludes
// `password`/`pendingTempPassword` (credentials: searchable would be a
// password oracle), `image` (URL), and `status` (enum). Mirrors backend-drizzle.
registerSearchFields(User, [
  'email',
  'username',
  'displayUsername',
  'name',
  'firstName',
  'lastName',
  'phone',
]);

export interface UserModel extends Model<User>, PaginateModel<User>, AggregatePaginateModel<User> {
  isEmailTaken(email: string, excludeUserId?: string): Promise<boolean>;
  validatePassword(password: string): Promise<boolean>;
}
