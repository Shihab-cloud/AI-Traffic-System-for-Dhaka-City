import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { BaseSchema } from '../base.schema';
import { EvidenceImage, PlateRead } from './violation.schema';

/** Two words on the vehicle's look ("grey SUV"), from the vision service's local vision-language model. */
export class VehicleAppearance {
  /** pending: waiting for the model (it runs while no surveillance box is running) */
  status!: 'pending' | 'done' | 'failed';
  text?: string;
  model?: string;
  error?: string;
  attempts?: number;
  describedAt?: Date;
}

/**
 * One vehicle that passed a camera, from first to last seen: a row of the passed-vehicle list. Written by the
 * other-violations box (every vehicle, with its plate read; since 2026-10-28) and, before that, by the plate-tracking
 * box (vehicles whose plate it found).
 */
@Schema({ collection: 'plate_sightings', timestamps: true, versionKey: false })
export class PlateSighting extends BaseSchema {
  @Prop({ type: String, required: true, unique: true })
  sightingId!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Camera', index: true })
  cameraId?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  cameraName!: string;

  @Prop({ type: String, index: true })
  runId!: string;

  @Prop({ type: Number })
  trackId!: number;

  @Prop({ type: String })
  vehicleClass!: string;

  @Prop({ type: Object })
  plate!: PlateRead;

  @Prop({ type: String, default: '', index: true })
  regKey!: string;

  /** The 6 digits, when the read has them: finds vehicles whose area/letter were not read. */
  @Prop({ type: String, default: '', index: true })
  numberKey!: string;

  @Prop({ type: Date, required: true, index: true })
  firstSeen!: Date;

  @Prop({ type: Date, required: true })
  lastSeen!: Date;

  @Prop({ type: Number })
  completeReads?: number;

  @Prop({ type: [Object], default: [] })
  images!: EvidenceImage[];

  /** The surveillance box that saw it ("violations"; "plates" for the former plate-tracking box). */
  @Prop({ type: String, default: '' })
  slot!: string;

  @Prop({ type: Object })
  appearance?: VehicleAppearance;

  // ---- multi-camera identity (VehicleIdentityService) ----

  /** Vehicle ID (DV-000123) across the camera network; '' until assigned */
  @Prop({ type: String, default: '' })
  vid!: string;

  /** bottom-centre of its first / last box, as a fraction of the frame (x, y in 0..1) */
  @Prop({ type: [Number] })
  entry?: number[];

  @Prop({ type: [Number] })
  exit?: number[];

  /** the camera's gates (Camera.network) it came in / went out through; '' = none drawn or none near */
  @Prop({ type: String, default: '' })
  entryGate!: string;

  @Prop({ type: String, default: '' })
  exitGate!: string;

  @Prop({ type: [Number] })
  frameSize?: number[];

  /** appearance vector (float32, L2-normalised; DINOv2) and HSV colour histogram (float32, L1-normalised) */
  @Prop({ type: Buffer })
  embedding?: Buffer;

  @Prop({ type: Buffer })
  colour?: Buffer;

  @Prop({ type: String })
  reidModel?: string;

  /**
   * how the Vehicle ID was found: plate, link (from another camera; `hops` 2 = a camera in between missed it,
   * `late` = found when that camera's record arrived after this one), same-camera, new, or later (this record
   * arrived after the next camera's: it took the ID given there)
   */
  @Prop({ type: Object })
  match?: {
    method: 'plate' | 'link' | 'same-camera' | 'new' | 'later';
    score?: number;
    margin?: number;
    candidates?: number;
    fromSightingId?: string;
    fromCameraName?: string;
    travelS?: number;
    hops?: number;
    viaCameraName?: string;
    late?: boolean;
    toSightingId?: string;
    toCameraName?: string;
    at: Date;
  };
}

export const PlateSightingSchema = SchemaFactory.createForClass(PlateSighting);
PlateSightingSchema.index({ cameraId: 1, runId: 1, firstSeen: 1 });
PlateSightingSchema.index({ 'appearance.status': 1, createdAt: -1 });
// a vehicle's route: its sightings by time
PlateSightingSchema.index({ vid: 1, firstSeen: -1 });
// candidates for the next camera: who left camera C through gate g between t1 and t2 (range scan, O(log n + k))
PlateSightingSchema.index({ cameraId: 1, exitGate: 1, lastSeen: -1 });
// same camera: tracks that ended just before a new one started
PlateSightingSchema.index({ cameraId: 1, lastSeen: -1 });
// a record that arrived late: who came in at the next camera's gate h between t1 and t2
PlateSightingSchema.index({ cameraId: 1, entryGate: 1, firstSeen: 1 });
// a violation's vehicle: the sighting of the same track in the same run
PlateSightingSchema.index({ runId: 1, trackId: 1 });
PlateSightingSchema.plugin(paginate);

export interface PlateSightingModel extends Model<PlateSighting>, PaginateModel<PlateSighting> {}
