import paginate from 'mongoose-paginate-v2';

import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { PreferenceConfigType } from 'src/shared/enums/notification-channel.enum';

@Schema({ collection: 'user_notification_settings', timestamps: true, versionKey: false })
export class UserNotificationSettings extends BaseSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: Types.ObjectId;

  @Prop({ type: Boolean, required: true, default: true })
  pushEnabled!: boolean;

  @Prop({ type: Boolean, required: true, default: false })
  emailFallbackEnabled!: boolean;

  @Prop({ type: Boolean, required: true, default: true })
  criticalBypassQuietHours!: boolean;

  // Quiet-hours window stored as 'HH:mm' wall-clock strings; null = unset.
  @Prop({ type: String, default: null })
  quietHoursStart!: string | null;

  @Prop({ type: String, default: null })
  quietHoursEnd!: string | null;

  @Prop({ type: String, required: true, default: 'UTC' })
  timezone!: string;

  // Sparse per-channel push override; null/absent ⇒ all channels at defaults.
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  preferences!: PreferenceConfigType | null;
}

export const UserNotificationSettingsSchema =
  SchemaFactory.createForClass(UserNotificationSettings);

UserNotificationSettingsSchema.plugin(paginate);

UserNotificationSettingsSchema.loadClass(UserNotificationSettings);

export interface UserNotificationSettingsModel
  extends Model<UserNotificationSettings>, PaginateModel<UserNotificationSettings> {}
