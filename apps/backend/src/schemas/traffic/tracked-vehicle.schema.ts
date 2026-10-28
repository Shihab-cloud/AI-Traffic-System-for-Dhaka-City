import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { BaseSchema } from '../base.schema';

/** Where and when a camera saw the vehicle (the start or the end of one sighting). */
export class VehicleSeenAt {
  cameraId?: Types.ObjectId;
  cameraName!: string;
  cameraCode?: string;
  at!: Date;
  sightingId!: string;
  gate?: string;
}

/**
 * One vehicle as the whole camera network knows it: the Vehicle ID (DV-000123) given when a camera first listed it,
 * kept for every later sighting at any camera (VehicleIdentityService). Not the owner register (`vehicles`).
 *
 * Search paths, all on indexes (O(log n) per lookup, n = vehicles): `vid`; `regKey` / `numberKey` (plate);
 * `appearance.colour` + `appearance.type` (+ `last.at` for newest first); `last.cameraId` (+ `last.at`).
 */
@Schema({ collection: 'tracked_vehicles', timestamps: true, versionKey: false })
export class TrackedVehicle extends BaseSchema {
  @Prop({ type: String, required: true, unique: true })
  vid!: string;

  @Prop({ type: Number, required: true, unique: true })
  seq!: number;

  /** the class most of its sightings gave */
  @Prop({ type: String, default: '' })
  vehicleClass!: string;

  @Prop({ type: Object, default: {} })
  classVotes!: Record<string, number>;

  /** best plate known: an officer's entry, else the most trusted read */
  @Prop({ type: String, default: '' })
  registration!: string;

  @Prop({ type: String, default: '' })
  regKey!: string;

  @Prop({ type: String, default: '' })
  numberKey!: string;

  @Prop({ type: String, default: '' })
  plateStatus!: string;

  /** "white SUV", from the vision-language model, with its two parts (lower case) for search: the description most
   * of its sightings got (`appearanceVotes`) */
  @Prop({ type: Object })
  appearance?: { text: string; colour: string; type: string };

  @Prop({ type: Object, default: {} })
  appearanceVotes!: Record<string, number>;

  /** running mean of its sightings' appearance vectors (float32, L2-normalised) */
  @Prop({ type: Buffer })
  embedding?: Buffer;

  /** running mean of its colour histograms (float32, L1-normalised) */
  @Prop({ type: Buffer })
  colour?: Buffer;

  @Prop({ type: Number, default: 0 })
  embeddingCount!: number;

  @Prop({ type: Object, required: true })
  first!: VehicleSeenAt;

  /** the last camera that saw it: what an officer tracking it wants first */
  @Prop({ type: Object, required: true })
  last!: VehicleSeenAt;

  @Prop({ type: Number, default: 0 })
  sightings!: number;

  @Prop({ type: Number, default: 0 })
  cameraCount!: number;

  @Prop({ type: Number, default: 0 })
  violations!: number;

  @Prop({ type: Object })
  lastViolation?: { id: string; code: string; title: string; at: Date; cameraName: string };

  /** IDs found later to be this same vehicle (a record arrived late) and joined to it; they still find it */
  @Prop({ type: [String], default: undefined })
  mergedVids?: string[];
}

export const TrackedVehicleSchema = SchemaFactory.createForClass(TrackedVehicle);
// Plate lookups only on vehicles that have one (most do not: the camera rarely reads them).
TrackedVehicleSchema.index({ regKey: 1 }, { partialFilterExpression: { regKey: { $gt: '' } } });
TrackedVehicleSchema.index({ numberKey: 1 }, { partialFilterExpression: { numberKey: { $gt: '' } } });
TrackedVehicleSchema.index({ 'last.at': -1 });
TrackedVehicleSchema.index({ 'appearance.colour': 1, 'appearance.type': 1, 'last.at': -1 });
TrackedVehicleSchema.index({ 'appearance.type': 1, 'last.at': -1 });
TrackedVehicleSchema.index({ vehicleClass: 1, 'last.at': -1 });
TrackedVehicleSchema.index({ 'last.cameraId': 1, 'last.at': -1 });
TrackedVehicleSchema.index({ mergedVids: 1 }, { sparse: true });
TrackedVehicleSchema.plugin(paginate);

export interface TrackedVehicleModel extends Model<TrackedVehicle>, PaginateModel<TrackedVehicle> {}
