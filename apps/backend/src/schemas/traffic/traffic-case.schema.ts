import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { registerSearchFields } from 'src/utils/search-registry';
import { BaseSchema } from '../base.schema';

export enum CaseStatusEnum {
  UNPAID = 'unpaid',
  UNDER_REVIEW = 'under_review',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

/** A ticket sent to a vehicle owner for one violation ("case" on the owner's page). */
@Schema({ collection: 'cases', timestamps: true, versionKey: false })
export class TrafficCase extends BaseSchema {
  @Prop({ type: String, required: true, unique: true })
  caseNumber!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Violation', required: true, unique: true })
  violationId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  registration!: string;

  @Prop({ type: String, required: true, index: true })
  regKey!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vehicle' })
  vehicleId?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  ownerName!: string;

  @Prop({ type: String, lowercase: true, trim: true, index: true })
  ownerEmail?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  ownerUserId?: Types.ObjectId;

  @Prop({ type: String, required: true })
  code!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: String, default: '' })
  legalReference!: string;

  @Prop({ type: String, default: CaseStatusEnum.UNPAID, index: true })
  status!: CaseStatusEnum;

  @Prop({ type: Date, required: true })
  issuedAt!: Date;

  @Prop({ type: Date, required: true })
  dueDate!: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  issuedById?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  issuedByName!: string;

  @Prop({ type: String, default: '' })
  officerNote!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: String })
  invoiceNumber?: string;

  @Prop({ type: Date })
  emailedAt?: Date;

  @Prop({ type: String })
  emailError?: string;

  /** Vehicle ID across the camera network (DV-000123), from the violation */
  @Prop({ type: String, default: '', index: true })
  vid!: string;
}

export const TrafficCaseSchema = SchemaFactory.createForClass(TrafficCase);
TrafficCaseSchema.plugin(paginate);
registerSearchFields(TrafficCase, ['caseNumber', 'registration', 'ownerName', 'ownerEmail', 'title']);

export interface TrafficCaseModel extends Model<TrafficCase>, PaginateModel<TrafficCase> {}
