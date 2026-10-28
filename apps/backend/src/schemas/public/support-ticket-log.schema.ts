import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Schema as MongooseSchema, PaginateModel, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import type {
  SupportTicketLogAttachment,
  SupportTicketLogDetails,
} from 'src/lib/types/support.types';
import { BaseSchema } from '../base.schema';
import { User } from './user.schema';
import { SupportTicketLogTypeEnum } from 'src/shared/enums/support.enum';
import { SupportTicket } from './support-ticket.schema';
import { registerSearchFields } from 'src/utils/search-registry';

/**
 * Mirrors drizzle `support_ticket_logs`. `details`/`attachments` are flexible
 * sub-documents (typed at the TS layer). `message` is the human-readable
 * summary; `performedById` is a nullable ObjectId ref. Only `createdAt` is
 * tracked (drizzle has no `updatedAt` on logs).
 */
@Schema({
  collection: 'support_ticket_logs',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class SupportTicketLog extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: SupportTicket.name,
    required: true,
    index: true,
  })
  ticketId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  type!: SupportTicketLogTypeEnum;

  // Human-readable summary sentence — rendered directly in UI.
  @Prop({ type: String, default: null })
  message?: string | null;

  // Type-specific payload — typed at TS level, flexible in Mongo.
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  details?: SupportTicketLogDetails | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, default: null })
  performedById?: Types.ObjectId | null;

  @Prop({ type: [Object], default: [] })
  attachments!: SupportTicketLogAttachment[];
}

export const SupportTicketLogSchema = SchemaFactory.createForClass(SupportTicketLog);

SupportTicketLogSchema.plugin(paginate);

SupportTicketLogSchema.loadClass(SupportTicketLog);

// `?search=` matches the human-readable summary only — not `type` (enum) or
// `details`/`attachments` (payload objects). Mirrors backend-drizzle.
registerSearchFields(SupportTicketLog, ['message']);

export interface SupportTicketLogModel
  extends Model<SupportTicketLog>, PaginateModel<SupportTicketLog> {}
