import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { BaseSchema } from '../base.schema';

/** Fine schedule: one row per violation code. Amounts are set by the admin (seeded defaults must be checked). */
@Schema({ collection: 'fines', timestamps: true, versionKey: false })
export class Fine extends BaseSchema {
  @Prop({ type: String, required: true, unique: true })
  code!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  /** Days the owner has to pay or ask for a review. */
  @Prop({ type: Number, default: 30, min: 1 })
  dueDays!: number;

  /** Legal basis shown on tickets and invoices (filled in by the admin). */
  @Prop({ type: String, default: '' })
  legalReference!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: Boolean, default: true })
  active!: boolean;
}

export const FineSchema = SchemaFactory.createForClass(Fine);

export type FineModel = Model<Fine>;
