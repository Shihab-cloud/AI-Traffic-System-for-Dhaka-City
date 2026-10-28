import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, QueryFilter, Types } from 'mongoose';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { PlateSighting, PlateSightingModel } from 'src/schemas/traffic/plate-sighting.schema';
import { SurveillanceRun, SurveillanceRunModel } from 'src/schemas/traffic/surveillance-run.schema';
import { EvidenceService } from './evidence.service';
import { dhakaTime } from './traffic.util';
import { VehicleIdentityService } from './vehicle-identity.service';
import { VisionClientService } from './vision-client.service';

/** Vehicles sent to the vision service's /describe at a time (~0.5-1 s each). */
const DESCRIBE_BATCH = 8;
/** Nothing to describe, the vision service offline, or a box running: look again after this. */
const IDLE_MS = 30_000;
const MAX_ATTEMPTS = 3;

export type PassedVehicleFilter = { cameraId?: string; runId?: string; search?: string };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The passed-vehicle list: every vehicle the other-violations box saw pass a camera (vision `plate_sightings`), with
 * its plate and a two-word look ("grey SUV") that the vision service's local vision-language model writes from the
 * vehicle image. The model and a running box do not fit in the GPU together, so descriptions are made by a background
 * loop whenever no box runs (the vision service answers 409 while one does), newest run first.
 */
@Injectable()
export class PassedVehiclesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PassedVehiclesService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    @InjectModel(PlateSighting.name) private readonly sightings: PlateSightingModel,
    @InjectModel(Camera.name) private readonly cameraModel: CameraModel,
    @InjectModel(SurveillanceRun.name) private readonly runModel: SurveillanceRunModel,
    private readonly evidence: EvidenceService,
    private readonly vision: VisionClientService,
    private readonly identity: VehicleIdentityService,
  ) {}

  onModuleInit() {
    this.schedule(15_000);
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Every camera, the ones with the most recently listed vehicles first. */
  async cameras() {
    const [cams, counts] = await Promise.all([
      this.cameraModel.find().select('name code address active').lean(),
      this.sightings.aggregate<{ _id: Types.ObjectId; vehicles: number; lastAt: Date }>([
        { $match: { cameraId: { $ne: null } } },
        { $group: { _id: '$cameraId', vehicles: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
      ]),
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c]));
    return cams
      .map((c) => ({
        id: String(c._id),
        name: c.name,
        code: c.code,
        address: c.address ?? '',
        vehicles: byId.get(String(c._id))?.vehicles ?? 0,
        lastAt: byId.get(String(c._id))?.lastAt ?? null,
      }))
      .sort((a, b) => new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime() || a.name.localeCompare(b.name));
  }

  /** The runs that listed vehicles at this camera, newest first. */
  async runs(cameraId: string) {
    if (!isValidObjectId(cameraId)) return [];
    const groups = await this.sightings.aggregate<{
      _id: string;
      vehicles: number;
      pending: number;
      from: Date;
      to: Date;
      createdAt: Date;
    }>([
      { $match: { cameraId: new Types.ObjectId(cameraId) } },
      {
        $group: {
          _id: '$runId',
          vehicles: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$appearance.status', 'pending'] }, 1, 0] } },
          from: { $min: '$firstSeen' },
          to: { $max: '$lastSeen' },
          createdAt: { $max: '$createdAt' },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 100 },
    ]);
    const runs = await this.runModel
      .find({ runId: { $in: groups.map((g) => g._id) } })
      .select('runId slot state source startedAt endedAt')
      .lean();
    const runById = new Map(runs.map((r) => [r.runId, r]));
    return groups.map((g) => {
      const r = runById.get(g._id);
      return {
        runId: g._id,
        vehicles: g.vehicles,
        describing: g.pending,
        from: g.from,
        to: g.to,
        startedAt: r?.startedAt ?? null,
        state: r?.state ?? '',
        slot: r?.slot ?? '',
        source: r?.source?.value ?? '',
      };
    });
  }

  private match(f: PassedVehicleFilter): QueryFilter<PlateSighting> {
    const q: QueryFilter<PlateSighting> = {};
    if (f.cameraId && isValidObjectId(f.cameraId)) q.cameraId = new Types.ObjectId(f.cameraId);
    if (f.runId) q.runId = f.runId;
    const s = f.search?.trim();
    if (s) {
      const rx = { $regex: escapeRegex(s), $options: 'i' };
      const id = /^#?\d+$/.test(s) ? [{ trackId: Number(s.replace('#', '')) }] : [];
      q.$or = [...id, { 'plate.registration': rx }, { vehicleClass: rx }, { 'appearance.text': rx }];
    }
    return q;
  }

  async list(f: PassedVehicleFilter, page = 1, limit = 50) {
    const res = await this.sightings.paginate(this.match(f), {
      page,
      limit,
      sort: { firstSeen: 1, trackId: 1 },
      lean: true,
    });
    const docs = await Promise.all(
      res.docs.map(async (s) => {
        const images = await this.evidence.sign(s.images ?? []);
        const url = (kind: string) => images.find((i) => i.kind === kind)?.url ?? '';
        return {
          id: String(s._id),
          trackId: s.trackId,
          vid: s.vid ?? '',
          vehicleClass: s.vehicleClass,
          registration: s.plate?.registration ?? '',
          plateStatus: s.plate?.status ?? '',
          plateWidthPx: s.plate?.plateWidthPx ?? 0,
          firstSeen: s.firstSeen,
          lastSeen: s.lastSeen,
          appearance: s.appearance ? { status: s.appearance.status, text: s.appearance.text ?? '' } : null,
          cameraName: s.cameraName,
          runId: s.runId,
          vehicleImage: url('vehicle') || url('evidence'),
          plateImage: url('plate'),
          evidenceImage: url('evidence'),
        };
      }),
    );
    return { ...res, docs };
  }

  /** The list as a CSV file (Excel opens it: UTF-8 with BOM), in the page's columns. */
  async csv(f: PassedVehicleFilter): Promise<{ name: string; data: Buffer }> {
    const rows = await this.sightings.find(this.match(f)).sort({ firstSeen: 1, trackId: 1 }).limit(50_000).lean();
    const cell = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['Vehicle ID', 'Vehicle class', 'Registration number', 'Plate status', 'First seen', 'Last seen', 'Appearance', 'Camera'],
      ...rows.map((s) => [
        s.trackId,
        s.vehicleClass,
        s.plate?.registration ?? '',
        s.plate?.status ?? '',
        dhakaTime(s.firstSeen),
        dhakaTime(s.lastSeen),
        s.appearance?.status === 'done' ? s.appearance.text : '',
        s.cameraName,
      ]),
    ].map((r) => r.map(cell).join(','));
    const cam = f.cameraId && isValidObjectId(f.cameraId) ? await this.cameraModel.findById(f.cameraId).select('code').lean() : null;
    const day = rows.length ? dhakaTime(rows[0].firstSeen).slice(0, 10) : 'empty';
    return {
      name: `passed_vehicles_${cam?.code ?? 'all'}_${day}.csv`,
      data: Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8'),
    };
  }

  // ─── descriptions ───

  private schedule(ms: number) {
    if (!this.stopped) this.timer = setTimeout(() => void this.describeLoop(), ms);
  }

  private async describeLoop() {
    let next = IDLE_MS;
    try {
      if ((await this.describeSome()) > 0) next = 200;   // more may be waiting
    } catch (err) {
      this.logger.warn(`Vehicle descriptions: ${(err as Error).message}`);
    }
    this.schedule(next);
  }

  /** Describes up to DESCRIBE_BATCH waiting vehicles of the newest run; returns how many it described. */
  private async describeSome(): Promise<number> {
    const newest = await this.sightings
      .findOne({ 'appearance.status': 'pending' })
      .sort({ createdAt: -1 })
      .select('runId')
      .lean();
    if (!newest) return 0;
    const batch = await this.sightings
      .find({ 'appearance.status': 'pending', runId: newest.runId })
      .sort({ firstSeen: 1 })
      .limit(DESCRIBE_BATCH)
      .lean();
    const ready: { id: string; vehicleClass: string; data: string }[] = [];
    for (const s of batch) {
      const img = s.images.find((i) => i.kind === 'vehicle');
      try {
        if (!img) throw new Error('no vehicle image');
        ready.push({ id: String(s._id), vehicleClass: s.vehicleClass, data: (await this.evidence.read(img.key)).toString('base64') });
      } catch (err) {
        await this.fail(String(s._id), `Vehicle image not readable: ${(err as Error).message}`, MAX_ATTEMPTS);
      }
    }
    if (!ready.length) return batch.length;
    let answer: { descriptions: string[]; model: string };
    try {
      answer = await this.vision.request(
        '/describe',
        { method: 'POST', body: JSON.stringify({ vehicles: ready.map(({ vehicleClass, data }) => ({ vehicleClass, data })) }) },
        180_000,
      );
    } catch (err) {
      // a box running (409) or the vision service down: the vehicles stay pending
      if (err instanceof ServiceUnavailableException || (err instanceof HttpException && err.getStatus() === 409)) return 0;
      const message = (err as Error).message;
      for (const r of ready) await this.fail(r.id, message);
      if (err instanceof BadGatewayException) this.logger.warn(`Vehicle descriptions: ${message}`);
      return 0;
    }
    const at = new Date();
    await this.sightings.bulkWrite(
      ready.map((r, i) => ({
        updateOne: {
          filter: { _id: r.id },
          update: {
            $set: {
              appearance: { status: 'done' as const, text: answer.descriptions[i] ?? '', model: answer.model, describedAt: at },
            },
          },
        },
      })),
    );
    for (const [i, r] of ready.entries()) {
      const text = answer.descriptions[i];
      if (text) await this.identity.onAppearance(r.id, text).catch(() => undefined);
    }
    return ready.length;
  }

  /** One more failed attempt; after MAX_ATTEMPTS the vehicle is left undescribed. */
  private async fail(id: string, error: string, attempts = 1) {
    const s = await this.sightings.findById(id).select('appearance').lean();
    const n = (s?.appearance?.attempts ?? 0) + attempts;
    await this.sightings.updateOne(
      { _id: id },
      { $set: { appearance: { status: n >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts: n, error } } },
    );
  }
}
