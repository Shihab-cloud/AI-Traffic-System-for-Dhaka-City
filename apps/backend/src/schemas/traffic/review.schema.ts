import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { BaseSchema } from '../base.schema';

export enum ReviewStatusEnum {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

/** An owner's request to review (appeal) a ticket. Accepted = ticket cancelled; rejected = pay as before. */
@Schema({ collection: 'reviews', timestamps: true, versionKey: false })
export class Review extends BaseSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TrafficCase', required: true, index: true })
  caseId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  caseNumber!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  userEmail!: string;

  /** wrong_vehicle | not_me_driving | emergency | wrong_reading | other */
  @Prop({ type: String, required: true })
  reason!: string;

  @Prop({ type: String, required: true })
  details!: string;

  @Prop({ type: String, default: ReviewStatusEnum.PENDING, index: true })
  status!: ReviewStatusEnum;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  decidedById?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  decidedByName!: string;

  @Prop({ type: Date })
  decidedAt?: Date;

  @Prop({ type: String, default: '' })
  decisionNote!: string;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.plugin(paginate);

export interface ReviewModel extends Model<Review>, PaginateModel<Review> {}
