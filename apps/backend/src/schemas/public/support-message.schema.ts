import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Schema as MongooseSchema, PaginateModel } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { BaseSchema } from '../base.schema';
import { User } from './user.schema';
import { SupportTicket } from './support-ticket.schema';
import { registerSearchFields } from 'src/utils/search-registry';

/**
 * Mirrors drizzle `support_messages`. `ticketId`/`senderId` are ObjectId refs.
 * Deletes cascade at the application layer (drizzle uses onDelete:'cascade').
 */
@Schema({
  collection: 'support_messages',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class SupportMessage extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: SupportTicket.name,
    required: true,
    index: true,
  })
  ticketId!: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  senderId!: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, required: true })
  content!: string;
}

export const SupportMessageSchema = SchemaFactory.createForClass(SupportMessage);

SupportMessageSchema.plugin(paginate);

SupportMessageSchema.loadClass(SupportMessage);

// `?search=` matches message content (mirrors backend-drizzle).
registerSearchFields(SupportMessage, ['content']);

export interface SupportMessageModel extends Model<SupportMessage>, PaginateModel<SupportMessage> {}
