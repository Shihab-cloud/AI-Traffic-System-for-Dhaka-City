import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { registerSearchFields } from 'src/utils/search-registry';
import { BaseSchema } from '../base.schema';

/** Where the camera's default video comes from: an IP camera URL, a webcam, or a video file on the vision host. */
export class CameraSource {
  kind!: 'ip' | 'webcam' | 'file' | 'upload';
  value!: string;
}

/**
 * One camera view. `zones` is the vision pipelines' camera config, as the scripts read it from a JSON file:
 * `{frame_size, zones: [{name, points, width_m, length_m, type?, road_category?, allowed_direction?,
 * speed_limit_kph?, banned_classes?, stopping_allowed?} | {type: 'bus_stop' | ..., name, points}],
 * lane_lines?, peak_hours?}`. Road zones are rectangles on the road: the speed box uses those with a measured size
 * (every speed depends on it); for the other violations the size may be empty (estimated from vehicle sizes).
 */
@Schema({ collection: 'cameras', timestamps: true, versionKey: false })
export class Camera extends BaseSchema {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  /** Short unique code shown on evidence and used by multi-camera tracking (e.g. "KAK-01", "c041"). */
  @Prop({ type: String, required: true, unique: true, trim: true })
  code!: string;

  @Prop({ type: String, default: '' })
  address!: string;

  @Prop({ type: Number })
  lat?: number;

  @Prop({ type: Number })
  lng?: number;

  @Prop({ type: Object })
  defaultSource?: CameraSource;

  @Prop({ type: Object })
  zones?: Record<string, unknown>;

  /** Default limit where a road zone sets none (Dhaka city roads: 60 km/h). */
  @Prop({ type: Number, default: 60 })
  speedLimitKph!: number;

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  @Prop({ type: String, default: '' })
  notes!: string;

  /**
   * Traffic direction observed per road zone by the last "other violations" run (the violation pipeline's
   * direction_suggestions): `{zones: {<road zone>: {toward, away, suggestion}}, runId, at}`. The zone editor offers
   * the suggestion as the zone's allowed direction.
   */
  @Prop({ type: Object })
  learning?: {
    zones: Record<string, { toward: number; away: number; suggestion: string | null }>;
    runId: string;
    at: Date;
  };

  /**
   * Its place in the camera network (multi-camera tracking): `gates` = areas of the picture where vehicles enter or
   * leave the view (pixel corners at `frameSize`), `links` = where a vehicle leaving through a gate turns up next:
   * `{fromGate, toCameraId, toGate, minS, maxS, distanceM?}`. Without links a vehicle keeps its Vehicle ID at this
   * camera only (and when its confirmed plate is read elsewhere).
   */
  @Prop({ type: Object })
  network?: {
    frameSize?: number[];
    gates: { id: string; name: string; points: number[][] }[];
    links: { fromGate: string; toCameraId: string; toGate: string; minS: number; maxS: number; distanceM?: number }[];
  };
}

export const CameraSchema = SchemaFactory.createForClass(Camera);
CameraSchema.index({ 'network.links.toCameraId': 1 });
CameraSchema.plugin(paginate);
registerSearchFields(Camera, ['name', 'code', 'address']);

export interface CameraModel extends Model<Camera>, PaginateModel<Camera> {}
