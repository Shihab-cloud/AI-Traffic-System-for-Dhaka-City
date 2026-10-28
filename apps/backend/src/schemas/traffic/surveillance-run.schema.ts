import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { BaseSchema } from '../base.schema';

/** One start..stop of a surveillance box (speed / violations / plates) in the vision service. */
@Schema({ collection: 'surveillance_runs', timestamps: true, versionKey: false })
export class SurveillanceRun extends BaseSchema {
  @Prop({ type: String, required: true, unique: true })
  runId!: string;

  @Prop({ type: String, required: true, index: true })
  slot!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Camera' })
  cameraId?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  cameraName!: string;

  /** running | finished | stopped | error */
  @Prop({ type: String, required: true })
  state!: string;

  @Prop({ type: String, default: '' })
  error!: string;

  @Prop({ type: Object })
  source?: { kind: string; value: string; live?: boolean };

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  endedAt?: Date;

  @Prop({ type: Object, default: {} })
  stats!: Record<string, number>;

  @Prop({ type: Object, default: {} })
  progress!: Record<string, number>;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  startedById?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  startedByName!: string;
}

export const SurveillanceRunSchema = SchemaFactory.createForClass(SurveillanceRun);
SurveillanceRunSchema.plugin(paginate);

export interface SurveillanceRunModel extends Model<SurveillanceRun>, PaginateModel<SurveillanceRun> {}
