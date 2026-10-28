import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { registerSearchFields } from 'src/utils/search-registry';
import { BaseSchema } from '../base.schema';

export enum ViolationStatusEnum {
  NEW = 'new',
  TICKETED = 'ticketed',
  DISMISSED = 'dismissed',
}

/** An evidence image in S3 (`key`), e.g. scene / closeup / plate / stopped. */
export class EvidenceImage {
  kind!: string;
  key!: string;
  caption?: string;
}

/** A plate read, as voted over many frames by the vision service (plate_reader.py's PlateVotes). */
export class PlateRead {
  registration!: string;
  number!: string;
  area!: string;
  metro!: boolean;
  letter!: string;
  /** confirmed | uncertain | partial | unreadable | no plate found */
  status!: string;
  confidence!: number;
  agreeingReads!: number;
  plateWidthPx!: number;
}

export class VlmExplanation {
  /** pending | done | failed */
  status!: string;
  provider!: string;
  model?: string;
  explanation?: string;
  supportsViolation?: string;
  vehicleDescription?: string;
  concerns?: string[];
  error?: string;
  requestedAt?: Date;
  completedAt?: Date;
  /** The explanation also looked at frames of the violation clip. */
  usedClip?: boolean;
}

/** 15 s of the source video around the violation, the vehicle boxed (vision/service/clips.py). */
export class VideoClip {
  /** pending: being made; failed: none (error says why, e.g. the video file is gone or the source was live) */
  status!: 'pending' | 'done' | 'failed';
  key?: string;
  /** video times the clip covers, and of the violation */
  fromS?: number;
  toS?: number;
  atS?: number;
  /** the vehicle was found in the clip and boxed */
  marked?: boolean;
  error?: string;
  requestedAt?: Date;
  madeAt?: Date;
}

@Schema({ collection: 'violations', timestamps: true, versionKey: false })
export class Violation extends BaseSchema {
  /** Id the vision service gave the event; plate results refer to it. */
  @Prop({ type: String, required: true, unique: true })
  eventId!: string;

  /** V1..V8 (V2 = over speed limit). */
  @Prop({ type: String, required: true, index: true })
  code!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: ViolationStatusEnum.NEW, index: true })
  status!: ViolationStatusEnum;

  @Prop({ type: Number })
  trackId!: number;

  @Prop({ type: String, index: true })
  vehicleClass!: string;

  @Prop({ type: Number })
  classConfidence?: number;

  @Prop({ type: Number })
  kph?: number;

  @Prop({ type: Number })
  avgKph?: number;

  @Prop({ type: Number })
  limitKph?: number;

  @Prop({ type: String, default: '' })
  zone!: string;

  @Prop({ type: [String], default: [] })
  areas!: string[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Camera', index: true })
  cameraId?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  cameraName!: string;

  /** speed | violations (surveillance box that found it) */
  @Prop({ type: String })
  slot!: string;

  @Prop({ type: String, index: true })
  runId!: string;

  @Prop({ type: Object })
  source?: { kind: string; value: string };

  @Prop({ type: Date, required: true, index: true })
  occurredAt!: Date;

  @Prop({ type: Number })
  videoTimeS?: number;

  @Prop({ type: Object, default: {} })
  details!: Record<string, unknown>;

  @Prop({ type: [Object], default: [] })
  images!: EvidenceImage[];

  @Prop({ type: [Number] })
  frameSize?: number[];

  @Prop({ type: [Number] })
  bbox?: number[];

  /** What the plate reader read (absent until the vehicle has left and its crops were read). */
  @Prop({ type: Object })
  plate?: PlateRead;

  /** Registration used for the ticket: the officer's correction, else the confirmed read. */
  @Prop({ type: String, default: '', index: true })
  registration!: string;

  /** Normalised registration (letters and digits only, upper case) for lookups. */
  @Prop({ type: String, default: '', index: true })
  regKey!: string;

  @Prop({ type: Object })
  vlm?: VlmExplanation;

  @Prop({ type: Object })
  clip?: VideoClip;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  reviewedById?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ type: String })
  dismissReason?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TrafficCase' })
  caseId?: Types.ObjectId;

  /** Vehicle ID across the camera network (DV-000123), set once the vehicle has left the view and been listed */
  @Prop({ type: String, default: '', index: true })
  vid!: string;
}

export const ViolationSchema = SchemaFactory.createForClass(Violation);
ViolationSchema.index({ status: 1, occurredAt: -1 });
ViolationSchema.index({ status: 1, createdAt: -1 }); // the officers' list: newest detection first
ViolationSchema.plugin(paginate);
registerSearchFields(Violation, ['registration', 'vehicleClass', 'title', 'cameraName', 'code']);

export interface ViolationModel extends Model<Violation>, PaginateModel<Violation> {}
