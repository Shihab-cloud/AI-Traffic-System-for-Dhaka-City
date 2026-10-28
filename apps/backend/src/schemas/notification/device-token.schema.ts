import paginate from 'mongoose-paginate-v2';

import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { NotificationDevicePlatformEnum } from 'src/shared/enums/notification-device-platform.enum';

@Schema({ collection: 'device_tokens', timestamps: true, versionKey: false })
export class DeviceToken extends BaseSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  token!: string;

  @Prop({ type: String, required: true })
  platform!: NotificationDevicePlatformEnum;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

DeviceTokenSchema.plugin(paginate);

DeviceTokenSchema.loadClass(DeviceToken);

export interface DeviceTokenModel extends Model<DeviceToken>, PaginateModel<DeviceToken> {}
