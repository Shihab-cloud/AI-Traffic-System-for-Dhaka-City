import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AggregatePaginateModel,
  Model,
  Schema as MongooseSchema,
  PaginateModel,
  Types,
} from 'mongoose';
import aggregatePaginate from 'mongoose-aggregate-paginate-v2';
import paginate from 'mongoose-paginate-v2';

import { BaseSchema } from '../base.schema';
import { User } from './user.schema';
import {
  SupportTicketCategoryEnum,
  SupportTicketPriorityEnum,
  SupportTicketStatusEnum,
} from 'src/shared/enums/support.enum';
import { registerSearchFields } from 'src/utils/search-registry';

/**
 * Mirrors drizzle `support_tickets`. Plain-String props for enums (no mongoose
 * enum validators — wire/validation parity is owned by the application layer).
 * `submittedById` is an ObjectId ref to `users`.
 */
@Schema({ collection: 'support_tickets', timestamps: true, versionKey: false })
export class SupportTicket extends BaseSchema {
  @Prop({ type: String, required: true, unique: true })
  ticketNumber!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true, index: true })
  submittedById!: Types.ObjectId;

  @Prop({ type: String, required: true })
  category!: SupportTicketCategoryEnum;

  @Prop({ type: String, required: true, default: SupportTicketPriorityEnum.MEDIUM })
  priority!: SupportTicketPriorityEnum;

  @Prop({ type: String, required: true, default: SupportTicketStatusEnum.SUBMITTED, index: true })
  status!: SupportTicketStatusEnum;

  @Prop({ type: String, required: true })
  subject!: string;

  @Prop({ type: String, required: true })
  description!: string;

  @Prop({ type: String, required: true, default: 'Support Team' })
  assignedTo!: string;

  @Prop({ type: Date, default: null })
  lastResponseAt?: Date | null;

  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);

SupportTicketSchema.plugin(paginate);
SupportTicketSchema.plugin(aggregatePaginate);

// `?search=` matches subject only (not description/assignedTo — mirrors backend-drizzle).
registerSearchFields(SupportTicket, ['subject']);

SupportTicketSchema.loadClass(SupportTicket);

export interface SupportTicketModel
  extends
    Model<SupportTicket>,
    PaginateModel<SupportTicket>,
    AggregatePaginateModel<SupportTicket> {}
