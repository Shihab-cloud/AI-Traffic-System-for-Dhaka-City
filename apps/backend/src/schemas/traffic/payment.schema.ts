import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { BaseSchema } from '../base.schema';

export enum PaymentStatusEnum {
  /** an SSLCommerz checkout was started; the gateway has not answered yet */
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  /** a test payment undone when its case was reset to unpaid (kept as a record, no longer counted) */
  VOIDED = 'voided',
}

/** One payment attempt for a case. Card numbers are never stored: only the method, a masked account and the result. */
@Schema({ collection: 'payments', timestamps: true, versionKey: false })
export class Payment extends BaseSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TrafficCase', required: true, index: true })
  caseId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  caseNumber!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  /** sslcommerz (the gateway; its sandbox unless SSLCOMMERZ_LIVE) | sandbox (built-in test payment) */
  @Prop({ type: String, required: true })
  provider!: string;

  /** card | bkash | nagad | rocket (built-in test); SSLCommerz: what the payer chose, e.g. "BKASH-BKash" */
  @Prop({ type: String, required: true })
  method!: string;

  /** e.g. "**** 4242" or "017*****678" */
  @Prop({ type: String, default: '' })
  account!: string;

  @Prop({ type: String, required: true, index: true })
  status!: PaymentStatusEnum;

  @Prop({ type: String, required: true, unique: true })
  transactionId!: string;

  @Prop({ type: String, default: '' })
  failureReason!: string;

  @Prop({ type: String, unique: true, sparse: true })
  invoiceNumber?: string;

  /** S3 key of the invoice PDF */
  @Prop({ type: String })
  invoiceKey?: string;

  @Prop({ type: String, default: '' })
  payerName!: string;

  @Prop({ type: String, default: '' })
  payerEmail!: string;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: Date })
  invoiceEmailedAt?: Date;

  /** SSLCommerz: the validation id it confirmed the payment with, and the bank / wallet transaction */
  @Prop({ type: String })
  validationId?: string;

  @Prop({ type: String })
  bankTransactionId?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.plugin(paginate);

export interface PaymentModel extends Model<Payment>, PaginateModel<Payment> {}
