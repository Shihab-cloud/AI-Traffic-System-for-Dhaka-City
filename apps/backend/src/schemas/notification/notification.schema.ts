import paginate from 'mongoose-paginate-v2';

import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { NotificationChannelEnum } from 'src/shared/enums/notification-channel.enum';
import { registerSearchFields } from 'src/utils/search-registry';
import type { DeliveryLogEntry, NotificationMetadata } from 'src/lib/types/notification.types';

@Schema({ collection: 'notifications', timestamps: true, versionKey: false })
export class Notification extends BaseSchema {
  // UUID of the user who emitted this notification, or null for system-emitted.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  publisher!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  subscriber!: Types.ObjectId;

  @Prop({ type: String, required: true })
  channelType!: NotificationChannelEnum;

  @Prop({ type: String, default: null })
  title!: string | null;

  @Prop({ type: String, required: true })
  messageContent!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  metadata!: NotificationMetadata | null;

  @Prop({ type: Boolean, required: true, default: false })
  read!: boolean;

  @Prop({ type: [MongooseSchema.Types.Mixed], required: true, default: [] })
  deliveryLogs!: DeliveryLogEntry[];

  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Inbox query — WHERE subscriber=? ORDER BY createdAt DESC.
NotificationSchema.index({ subscriber: 1, createdAt: -1 });
NotificationSchema.index({ subscriber: 1, read: 1 });
NotificationSchema.index({ expiresAt: 1 });

NotificationSchema.plugin(paginate);

NotificationSchema.loadClass(Notification);

// `?search=` matches title/messageContent (mirrors backend-drizzle).
registerSearchFields(Notification, ['title', 'messageContent']);

export interface NotificationModel extends Model<Notification>, PaginateModel<Notification> {}
