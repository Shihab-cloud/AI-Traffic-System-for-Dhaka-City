import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types } from 'mongoose';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { PlateSighting, PlateSightingModel } from 'src/schemas/traffic/plate-sighting.schema';
import {
  SurveillanceRun,
  SurveillanceRunModel,
} from 'src/schemas/traffic/surveillance-run.schema';
import { EvidenceImage, PlateRead, VideoClip, Violation, ViolationModel } from 'src/schemas/traffic/violation.schema';
import { isCompleteRegistration, numberKey, regKey } from './traffic.util';
import { VehicleIdentityService } from './vehicle-identity.service';
import { toFloats } from './vehicle-matching';
import { VlmService } from './vlm.service';

type Payload = Record<string, unknown>;

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const date = (v: unknown) => {
  const d = typeof v === 'number' ? new Date(v * 1000) : typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};
const images = (v: unknown): EvidenceImage[] =>
  Array.isArray(v)
    ? v
        .filter((i): i is EvidenceImage => !!i && typeof i.key === 'string' && typeof i.kind === 'string')
        .map((i) => ({ kind: i.kind, key: i.key, caption: str(i.caption) }))
    : [];
const cameraRef = (v: unknown) => (typeof v === 'string' && isValidObjectId(v) ? new Types.ObjectId(v) : undefined);
/** [x, y] fractions of the frame */
const point = (v: unknown) =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as number[]) : undefined;
/** base64 float32 vector from the vision service, kept as bytes */
const vector = (v: unknown) => (typeof v === 'string' && toFloats(v) ? Buffer.from(v, 'base64') : undefined);

/** Records the vision service sends (POST /api/vision/events): violations, plate reads, clips, plate sightings, runs. */
@Injectable()
export class VisionEventsService {
  private readonly logger = new Logger(VisionEventsService.name);

  constructor(
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(PlateSighting.name) private readonly sightings: PlateSightingModel,
    @InjectModel(SurveillanceRun.name) private readonly runs: SurveillanceRunModel,
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
    private readonly vlm: VlmService,
    private readonly identity: VehicleIdentityService,
  ) {}

  async handle(p: Payload) {
    switch (p.type) {
      case 'violation':
        return this.violation(p);
      case 'plate':
        return this.plate(p);
      case 'clip':
        return this.clip(p);
      case 'sighting':
        return this.sighting(p);
      case 'run':
        return this.run(p);
      default:
        throw new BadRequestException(`Unknown event type ${String(p.type)}`);
    }
  }

  private async violation(p: Payload) {
    const eventId = str(p.eventId);
    const occurredAt = date(p.occurredAt);
    if (!eventId || !str(p.code) || !occurredAt) throw new BadRequestException('eventId, code, occurredAt needed');
    const source = (p.source ?? {}) as { kind?: string; value?: string };
    // Upsert: the vision service re-sends records the backend did not acknowledge.
    await this.violations.updateOne(
      { eventId },
      {
        $setOnInsert: {
          eventId,
          code: str(p.code),
          title: str(p.title, str(p.code)),
          trackId: num(p.trackId),
          vehicleClass: str(p.vehicleClass),
          classConfidence: num(p.classConfidence),
          kph: num(p.kph),
          avgKph: num(p.avgKph),
          limitKph: num(p.limitKph),
          zone: str(p.zone),
          areas: Array.isArray(p.areas) ? p.areas.map(String) : [],
          cameraId: cameraRef(p.cameraId),
          cameraName: str(p.cameraName),
          slot: str(p.slot),
          runId: str(p.runId),
          source: { kind: str(source.kind), value: str(source.value) },
          occurredAt,
          videoTimeS: num(p.videoTimeS),
          details: (p.details && typeof p.details === 'object' ? p.details : {}) as Record<string, unknown>,
          images: images(p.images),
          frameSize: Array.isArray(p.frameSize) ? p.frameSize.map(Number) : undefined,
          bbox: Array.isArray(p.bbox) ? p.bbox.map(Number) : undefined,
          // the vision service is making its clip (a `clip` event follows)
          ...(p.clip === 'pending' ? { clip: { status: 'pending', requestedAt: new Date() } } : {}),
        },
      },
      { upsert: true },
    );
    void this.identity.onViolation(eventId).catch((err: Error) => this.logger.warn(`Vehicle ID: ${err.message}`));
    return { ok: true };
  }

  private plateRead(raw: unknown): PlateRead {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      registration: str(r.registration),
      number: str(r.number),
      area: str(r.area),
      metro: !!r.metro,
      letter: str(r.letter),
      status: str(r.status, 'unreadable'),
      confidence: num(r.confidence) ?? 0,
      agreeingReads: num(r.agreeingReads) ?? 0,
      plateWidthPx: num(r.plateWidthPx) ?? 0,
    };
  }

  private async plate(p: Payload) {
    const eventId = str(p.eventId);
    const plate = this.plateRead(p.plate);
    const v = await this.violations.findOne({ eventId });
    if (!v) {
      this.logger.warn(`Plate result for unknown violation ${eventId}`);
      return { ok: true, ignored: true };
    }
    const update: Record<string, unknown> = { plate };
    const newImages = images(p.images).filter((i) => !v.images.some((e) => e.key === i.key));
    if (newImages.length) update.images = [...v.images, ...newImages];
    // Only a confirmed, complete read fills the ticket registration; an officer's correction is never overwritten.
    if (!v.registration && plate.status === 'confirmed' && isCompleteRegistration(plate.registration)) {
      update.registration = plate.registration;
      update.regKey = regKey(plate.registration);
    }
    await this.violations.updateOne({ _id: v._id }, { $set: update });
    return { ok: true };
  }

  /** A violation clip made (or not) by the vision service. An explanation written before it is redone with it. */
  private async clip(p: Payload) {
    const eventId = str(p.eventId);
    const done = p.status === 'done' && !!str(p.key);
    const clip: VideoClip = done
      ? { status: 'done', key: str(p.key), fromS: num(p.fromS), toS: num(p.toS), atS: num(p.atS), marked: !!p.marked, madeAt: new Date() }
      : { status: 'failed', error: str(p.error, 'The clip could not be made'), madeAt: new Date() };
    const v = await this.violations.findOneAndUpdate({ eventId }, { $set: { clip } }, { new: true }).lean();
    if (!v) {
      this.logger.warn(`Clip for unknown violation ${eventId}`);
      return { ok: true, ignored: true };
    }
    if (done && v.vlm && v.vlm.status !== 'pending' && !v.vlm.usedClip) {
      await this.vlm.request(String(v._id), true).catch((err: Error) => this.logger.warn(`Explanation: ${err.message}`));
    }
    return { ok: true };
  }

  private async sighting(p: Payload) {
    const sightingId = str(p.sightingId);
    const firstSeen = date(p.firstSeen);
    if (!sightingId || !firstSeen) throw new BadRequestException('sightingId, firstSeen needed');
    const plate = this.plateRead(p.plate);
    const pics = images(p.images);
    await this.sightings.updateOne(
      { sightingId },
      {
        $setOnInsert: {
          sightingId,
          cameraId: cameraRef(p.cameraId),
          cameraName: str(p.cameraName),
          runId: str(p.runId),
          slot: str(p.slot),
          trackId: num(p.trackId),
          vehicleClass: str(p.vehicleClass),
          plate,
          regKey: isCompleteRegistration(plate.registration) ? regKey(plate.registration) : '',
          numberKey: numberKey(plate.number),
          firstSeen,
          lastSeen: date(p.lastSeen) ?? firstSeen,
          completeReads: num(p.completeReads),
          images: pics,
          // its look is described later from the vehicle image (PassedVehiclesService)
          ...(pics.some((i) => i.kind === 'vehicle') ? { appearance: { status: 'pending', attempts: 0 } } : {}),
          // multi-camera identity: where it came in and went out, and what it looks like
          entry: point(p.entry),
          exit: point(p.exit),
          frameSize: Array.isArray(p.frameSize) ? p.frameSize.map(Number) : undefined,
          embedding: vector(p.embedding),
          colour: vector(p.colour),
          reidModel: str(p.reidModel) || undefined,
        },
      },
      { upsert: true },
    );
    // its Vehicle ID: in the background, so the vision service's request returns at once
    void this.identity.assign(sightingId).catch(() => undefined);
    return { ok: true };
  }

  private async run(p: Payload) {
    const runId = str(p.runId);
    if (!runId) throw new BadRequestException('runId needed');
    const source = (p.source ?? {}) as { kind?: string; value?: string; live?: boolean };
    await this.runs.updateOne(
      { runId },
      {
        $set: {
          slot: str(p.slot),
          state: str(p.state, 'running'),
          error: str(p.error),
          cameraId: cameraRef(p.cameraId),
          cameraName: str(p.cameraName),
          source: { kind: str(source.kind), value: str(source.value), live: !!source.live },
          startedAt: date(p.startedAt),
          endedAt: date(p.endedAt),
          stats: (p.stats ?? {}) as Record<string, number>,
          progress: (p.progress ?? {}) as Record<string, number>,
        },
      },
      { upsert: true },
    );
    // Directions learned by the violations box: kept on the camera for the zone editor's suggestions.
    const camera = cameraRef(p.cameraId);
    const learning = p.learning as Record<string, { toward: number; away: number; suggestion: string | null }> | null;
    if (camera && learning && Object.keys(learning).length) {
      await this.cameras.updateOne({ _id: String(camera) }, { $set: { learning: { zones: learning, runId, at: new Date() } } });
    }
    return { ok: true };
  }
}
