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

import { FaqAudienceEnum } from 'src/shared/enums/faq.enum';
import { registerSearchFields } from 'src/utils/search-registry';
import { BaseSchema } from '../base.schema';
import { User } from './user.schema';

/**
 * Mirrors drizzle `faqs`. `audience` is a plain String array (no enum
 * validator — wire/validation parity is owned by the application layer).
 * `createdById` is an ObjectId ref to `users`.
 */
@Schema({ collection: 'faqs', timestamps: true, versionKey: false })
export class Faq extends BaseSchema {
  @Prop({ type: String, required: true })
  question!: string;

  @Prop({ type: String, required: true })
  answer!: string;

  @Prop({ type: String, required: true, default: 'General', index: true })
  category!: string;

  @Prop({ type: [String], required: true, default: [FaqAudienceEnum.PUBLIC], index: true })
  audience!: FaqAudienceEnum[];

  @Prop({ type: Boolean, required: true, default: false, index: true })
  isPublished!: boolean;

  @Prop({ type: Number, required: true, default: 0, index: true })
  displayOrder!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  createdById!: Types.ObjectId;
}

export const FaqSchema = SchemaFactory.createForClass(Faq);

FaqSchema.plugin(paginate);
FaqSchema.plugin(aggregatePaginate);

// `?search=` matches question/answer/category (mirrors backend-drizzle).
registerSearchFields(Faq, ['question', 'answer', 'category']);

FaqSchema.loadClass(Faq);

export interface FaqModel extends Model<Faq>, PaginateModel<Faq>, AggregatePaginateModel<Faq> {}
