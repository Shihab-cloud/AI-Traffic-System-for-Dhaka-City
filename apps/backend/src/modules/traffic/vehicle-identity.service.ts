import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, QueryFilter, Types } from 'mongoose';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { PlateSighting, PlateSightingModel } from 'src/schemas/traffic/plate-sighting.schema';
import { TrackedVehicle, TrackedVehicleModel, VehicleSeenAt } from 'src/schemas/traffic/tracked-vehicle.schema';
import { TrafficCase, TrafficCaseModel } from 'src/schemas/traffic/traffic-case.schema';
import { Violation, ViolationModel } from 'src/schemas/traffic/violation.schema';
import { AppearanceIndexService } from './appearance-index.service';
import { isCompleteRegistration, numberKey, regKey } from './traffic.util';
import {
  type CameraLinks,
  DEFAULT_MATCH,
  formatVid,
  gateAt,
  type GateDef,
  type MatchSettings,
  mergeMeans,
  parseAppearance,
  pickBest,
  plateRank,
  type Pt,
  type Route,
  routesOf,
  type Scored,
  scoreLinkCandidate,
  scoreSameCamera,
  type SightingFeatures,
  toBuffer,
  toFloats,
  updateMean,
} from './vehicle-matching';

interface CameraInfo {
  id: string;
  name: string;
  code: string;
  gates: GateDef[];
  frameSize?: number[];
}

interface CameraCache {
  at: number;
  cams: Map<string, CameraInfo>;
  /** routes (1 or 2 links) into / out of each camera */
  upstream: Map<string, Route[]>;
  downstream: Map<string, Route[]>;
}

type SightingRow = PlateSighting & { _id: Types.ObjectId };

interface Match {
  vid: string;
  method: 'plate' | 'link' | 'same-camera' | 'later';
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
}

/** A sighting at a downstream camera that started a new ID before this record arrived, and continues it. */
interface Later {
  sighting: SightingRow;
  /** its match now: came from this record */
  match: Match;
}

const CAMERA_CACHE_MS = 30_000;
/** most candidate sightings read per link (a link with more vehicles in its window than this is far too wide) */
const MAX_CANDIDATES = 300;
/** how many of a late record's look-alike downstream starters are asked again */
const MAX_LATER = 3;
/** the vid of a record being assigned, when it is offered to a later sighting before it has one */
const PENDING = '(this record)';
/** vid prefix of a record still waiting for its ID, when it competes for a later sighting */
const WAITING = '(waiting) ';
const FEATURE_FIELDS =
  'sightingId vid cameraId cameraName runId trackId slot vehicleClass plate regKey numberKey firstSeen lastSeen entry exit entryGate exitGate frameSize embedding colour';

function setting(name: string, fallback: number): number {
  const v = process.env[name];
  return v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback;
}

const pt = (v?: number[]): Pt | undefined => (Array.isArray(v) && v.length >= 2 ? [Number(v[0]), Number(v[1])] : undefined);

/**
 * Vehicle IDs across the camera network (see vehicle-matching.ts for the method). Each new sighting (a vehicle that
 * left a camera's view) is matched, in this order, by
 *  1. its confirmed plate (index on the registration),
 *  2. the same camera: a duplicate from another box, or the tracker's new number for a vehicle it lost,
 *  3. the road graph: vehicles that left a linked upstream gate inside the travel-time window; when none is
 *     accepted, the gates two links up (a camera in between missed it), with a stricter score,
 * and gets the matched vehicle's ID, or a new one. Records can arrive out of order (another camera's video processed
 * first, a delayed event): a record whose next camera already gave the vehicle a new ID joins that vehicle, keeping
 * the ID of its first camera (the later one stays as an alias, `mergedVids`). One sighting at a time, so two cameras
 * cannot both claim one upstream vehicle. Cost per sighting: a few index lookups plus k candidate comparisons (k^2
 * lookups at most for two links), independent of the number of cameras; no all-pairs step.
 */
@Injectable()
export class VehicleIdentityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VehicleIdentityService.name);
  private chain: Promise<unknown> = Promise.resolve();
  private rebuilding = false;
  private cache: CameraCache | null = null;
  private readonly cfg: MatchSettings = {
    accept: setting('MTMC_ACCEPT', DEFAULT_MATCH.accept),
    margin: setting('MTMC_MARGIN', DEFAULT_MATCH.margin),
    sameCameraGapS: setting('MTMC_SAME_CAMERA_GAP_S', DEFAULT_MATCH.sameCameraGapS),
    sameCameraDist: setting('MTMC_SAME_CAMERA_DIST', DEFAULT_MATCH.sameCameraDist),
    sameCameraAccept: setting('MTMC_SAME_CAMERA_ACCEPT', DEFAULT_MATCH.sameCameraAccept),
    skipAccept: setting('MTMC_SKIP_ACCEPT', DEFAULT_MATCH.skipAccept),
    skipDwellS: setting('MTMC_SKIP_DWELL_S', DEFAULT_MATCH.skipDwellS),
  };

  constructor(
    @InjectModel(PlateSighting.name) private readonly sightings: PlateSightingModel,
    @InjectModel(TrackedVehicle.name) private readonly vehicles: TrackedVehicleModel,
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(TrafficCase.name) private readonly cases: TrafficCaseModel,
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
    @InjectConnection() private readonly connection: Connection,
    private readonly index: AppearanceIndexService,
  ) {}

  onApplicationBootstrap() {
    // Sightings stored before multi-camera tracking existed (or while this was down) get their IDs, oldest first.
    setTimeout(() => void this.backfill(), 5_000);
  }

  /** A camera's gates or links changed. */
  invalidateCameras() {
    this.cache = null;
  }

  /** Gives the sighting its Vehicle ID; resolves to the ID (null when the sighting does not exist). */
  assign(sightingId: string): Promise<string | null> {
    const run = this.chain.then(() => this.assignNow(sightingId));
    this.chain = run.catch((err: Error) => this.logger.warn(`Vehicle ID for sighting ${sightingId}: ${err.message}`));
    return run;
  }

  /** A violation arrived: if its vehicle was already listed (rare: it is listed once it leaves), copy the ID. */
  async onViolation(eventId: string) {
    const v = await this.violations.findOne({ eventId }).select('runId trackId vid').lean();
    if (!v || v.vid || v.trackId == null || !v.runId) return;
    const s = await this.sightings.findOne({ runId: v.runId, trackId: v.trackId, vid: { $gt: '' } }).select('vid').lean();
    if (!s) return;
    await this.violations.updateOne({ _id: v._id }, { $set: { vid: s.vid } });
    await this.refreshViolations(s.vid);
  }

  /** A sighting (database id) was described ("white SUV"): one vote for its vehicle's description. */
  async onAppearance(id: string, text: string) {
    const s = await this.sightings.findById(id).select('vid').lean();
    if (s?.vid) await this.voteAppearance(s.vid, text);
  }

  /** An officer typed the registration on one of the vehicle's violations: it beats any camera read. */
  async onOfficerPlate(vid: string, registration: string) {
    if (!vid || !isCompleteRegistration(registration)) return;
    await this.vehicles.updateOne(
      { vid },
      { $set: { registration, regKey: regKey(registration), numberKey: numberKey(registration), plateStatus: 'set by officer' } },
    );
  }

  // ------------------------------------------------------------------------------------------ matching

  private async assignNow(sightingId: string): Promise<string | null> {
    const s = await this.sightings.findOne({ sightingId }).lean<SightingRow>();
    if (!s) return null;
    if (s.vid) return s.vid;
    const net = await this.cameraInfo();
    const camId = s.cameraId ? String(s.cameraId) : '';
    const cam = net.cams.get(camId);
    const frame = cam?.frameSize ?? s.frameSize;
    const entryGate = gateAt(pt(s.entry), cam?.gates, frame);
    const exitGate = gateAt(pt(s.exit), cam?.gates, frame);
    const f = this.features(s);
    const self = { ...s, entryGate, exitGate } as SightingRow;

    let match = await this.byPlate(s);
    if (!match && camId) match = await this.sameCamera(s, f);
    if (!match && camId) match = await this.byRoutes(s, f, entryGate, net.upstream.get(camId) ?? [], net);
    // A record that arrived after the next camera's: a vehicle that started a new ID there may continue this one.
    const later = camId && exitGate ? await this.laterSighting(self, f, match?.vid ?? '', net) : null;
    if (!match && later) {
      match = {
        vid: later.sighting.vid,
        method: 'later',
        score: later.match.score,
        margin: later.match.margin,
        toSightingId: later.sighting.sightingId,
        toCameraName: later.sighting.cameraName,
      };
    }
    const seq = match ? 0 : await this.nextSeq();
    const vid = match?.vid ?? formatVid(seq);

    const { vid: _matched, ...how } = match ?? { vid: '', method: 'new' as const };
    await this.sightings.updateOne({ _id: s._id }, { $set: { vid, entryGate, exitGate, match: { ...how, at: new Date() } } });
    const seenAt = (at: Date, gate: string): VehicleSeenAt => ({
      cameraId: s.cameraId,
      cameraName: s.cameraName,
      cameraCode: cam?.code,
      at,
      sightingId: s.sightingId,
      gate,
    });
    await this.updateVehicle(vid, seq, s, f, seenAt(s.firstSeen, entryGate), seenAt(s.lastSeen, exitGate));
    if (s.appearance?.status === 'done' && s.appearance.text) await this.voteAppearance(vid, s.appearance.text);
    await this.linkViolations(s, vid);
    if (later) {
      const { vid: _from, ...came } = later.match;
      await this.sightings.updateOne({ _id: later.sighting._id }, { $set: { match: { ...came, at: new Date() } } });
      // this record had an ID of its own (its earlier camera's): the later vehicle joins it
      if (later.sighting.vid !== vid) await this.merge(later.sighting.vid, vid);
    }
    return vid;
  }

  private async byPlate(s: SightingRow): Promise<Match | null> {
    if (plateRank(s.plate?.status) < 4 || !s.regKey) return null;
    const v = await this.vehicles.findOne({ regKey: s.regKey }).sort({ 'last.at': -1 }).select('vid').lean();
    return v ? { vid: v.vid, method: 'plate' } : null;
  }

  private async sameCamera(s: SightingRow, f: SightingFeatures): Promise<Match | null> {
    const from = new Date(new Date(s.firstSeen).getTime() - (this.cfg.sameCameraGapS + 3) * 1000);
    const to = new Date(new Date(s.lastSeen).getTime() + 3000);
    const near = await this.sightings
      .find({ cameraId: s.cameraId, lastSeen: { $gte: from, $lte: to }, vid: { $gt: '' }, sightingId: { $ne: s.sightingId } })
      .select(FEATURE_FIELDS)
      .sort({ lastSeen: -1 })
      .limit(MAX_CANDIDATES)
      .lean<SightingRow[]>();
    const scored: Scored<SightingRow>[] = [];
    for (const p of near) {
      const score = scoreSameCamera(f, this.features(p), p.runId === s.runId, this.cfg);
      if (score !== null) scored.push({ candidate: p, score, appearance: null });
    }
    const best = this.choose(scored, (p) => p.vid, { ...this.cfg, accept: this.cfg.sameCameraAccept });
    return best
      ? {
          vid: best.pick.candidate.vid,
          method: 'same-camera',
          score: round(best.pick.score),
          margin: round(best.margin),
          candidates: near.length,
          fromSightingId: best.pick.candidate.sightingId,
          fromCameraName: best.pick.candidate.cameraName,
        }
      : null;
  }

  /**
   * The road graph: the vehicles that left a gate one link up inside the travel-time window; when none of them is
   * accepted, two links up (a camera in between missed the vehicle), with the stricter skipAccept.
   * `pending`: a record being assigned that is not stored yet (a late record offered to a later sighting).
   */
  private async byRoutes(
    s: SightingRow,
    f: SightingFeatures,
    entryGate: string,
    routes: Route[],
    net: CameraCache,
    pending?: SightingRow,
  ): Promise<Match | null> {
    const one = routes.filter((r) => r.hops === 1);
    const two = routes.filter((r) => r.hops === 2);
    return (
      (await this.viaRoutes(s, f, entryGate, one, net, this.cfg, pending)) ??
      (two.length ? await this.viaRoutes(s, f, entryGate, two, net, { ...this.cfg, accept: this.cfg.skipAccept }, pending) : null)
    );
  }

  private async viaRoutes(
    s: SightingRow,
    f: SightingFeatures,
    entryGate: string,
    routes: Route[],
    net: CameraCache,
    cfg: MatchSettings,
    pending?: SightingRow,
  ): Promise<Match | null> {
    const first = new Date(s.firstSeen).getTime();
    const pool: { row: SightingRow; route: Route }[] = [];
    for (const route of routes) {
      if (route.toGate && entryGate && route.toGate !== entryGate) continue;
      const from = first - route.maxS * 1000;
      const to = first - route.minS * 1000;
      const q: QueryFilter<PlateSighting> = {
        cameraId: new Types.ObjectId(route.fromCameraId),
        vid: { $gt: '' },
        lastSeen: { $gte: new Date(from), $lte: new Date(to) },
      };
      if (route.fromGate) q.exitGate = route.fromGate;
      const rows = await this.sightings.find(q).select(FEATURE_FIELDS).sort({ lastSeen: -1 }).limit(MAX_CANDIDATES).lean<SightingRow[]>();
      for (const row of rows) pool.push({ row, route });
      const p = pending;
      if (!p) continue;
      const pLast = new Date(p.lastSeen).getTime();
      if (String(p.cameraId) === route.fromCameraId && (!route.fromGate || p.exitGate === route.fromGate) && pLast >= from && pLast <= to) {
        pool.push({ row: p, route });
      }
      // Asked again for a late record: the records still waiting for their IDs compete too (each as its own vehicle;
      // gates are given at assignment, so worked out here). Without them the first look-alike to arrive would win.
      const cam = net.cams.get(route.fromCameraId);
      const waiting = await this.sightings
        .find({ cameraId: q.cameraId, lastSeen: q.lastSeen, vid: { $in: ['', null] }, sightingId: { $ne: p.sightingId } })
        .select(FEATURE_FIELDS)
        .limit(MAX_CANDIDATES)
        .lean<SightingRow[]>();
      for (const w of waiting) {
        if (route.fromGate && gateAt(pt(w.exit), cam?.gates, cam?.frameSize ?? w.frameSize) !== route.fromGate) continue;
        pool.push({ row: { ...w, vid: `${WAITING}${w.sightingId}` } as SightingRow, route });
      }
    }
    if (!pool.length) return null;
    const movedOn = await this.movedOn(
      pool.map((p) => p.row),
      s,
    );
    const scored: Scored<{ row: SightingRow; route: Route }>[] = [];
    for (const p of pool) {
      if (movedOn(p.row)) continue;
      const score = scoreLinkCandidate(f, this.features(p.row));
      if (score !== null) scored.push({ candidate: p, score, appearance: null });
    }
    const best = this.choose(scored, (p) => p.row.vid, cfg);
    if (!best) return null;
    const { row: c, route } = best.pick.candidate;
    return {
      vid: c.vid,
      method: 'link',
      score: round(best.pick.score),
      margin: round(best.margin),
      candidates: pool.length,
      fromSightingId: c.sightingId,
      fromCameraName: c.cameraName,
      travelS: Math.round((first - new Date(c.lastSeen).getTime()) / 100) / 10,
      ...(route.hops === 2 ? { hops: 2, viaCameraName: net.cams.get(route.viaCameraId ?? '')?.name ?? '' } : {}),
    };
  }

  /**
   * One to one: a candidate whose vehicle was seen again after it left that camera (anywhere before this sighting,
   * or here at any time since) went on elsewhere or is matched here already. One index range per vehicle.
   */
  private async movedOn(rows: SightingRow[], s: SightingRow): Promise<(p: SightingRow) => boolean> {
    const vids = [...new Set(rows.map((r) => r.vid))].filter((v) => v && v !== PENDING && !v.startsWith(WAITING));
    if (!vids.length) return () => false;
    const earliest = Math.min(...rows.map((r) => new Date(r.lastSeen).getTime()));
    const first = new Date(s.firstSeen).getTime();
    const here = String(s.cameraId);
    const after = await this.sightings
      .find({ vid: { $in: vids }, firstSeen: { $gt: new Date(earliest) }, sightingId: { $ne: s.sightingId } })
      .select('vid firstSeen cameraId')
      .lean();
    const seen = new Map<string, { t: number; here: boolean }[]>();
    for (const x of after) {
      const list = seen.get(x.vid) ?? [];
      list.push({ t: new Date(x.firstSeen).getTime(), here: String(x.cameraId) === here });
      seen.set(x.vid, list);
    }
    return (p) => {
      const left = new Date(p.lastSeen).getTime();
      return (seen.get(p.vid) ?? []).some((x) => x.t > left && (x.here || x.t < first));
    };
  }

  /**
   * Out-of-order records (another camera's video processed first, an event delivered late): the sightings at the
   * cameras downstream of this one's exit gate, inside the routes' windows after it left, that started a new
   * vehicle there. Each of them (the most alike first) is matched again as when it arrived, now with this record
   * among its candidates; the first that picks this record continues it. O(k) lookups, like the forward match.
   */
  private async laterSighting(self: SightingRow, f: SightingFeatures, ownVid: string, net: CameraCache): Promise<Later | null> {
    const left = new Date(self.lastSeen).getTime();
    const found: SightingRow[] = [];
    for (const route of net.downstream.get(String(self.cameraId)) ?? []) {
      if (route.fromGate && route.fromGate !== self.exitGate) continue;
      const q: QueryFilter<PlateSighting> = {
        cameraId: new Types.ObjectId(route.toCameraId),
        firstSeen: { $gte: new Date(left + route.minS * 1000), $lte: new Date(left + route.maxS * 1000) },
        vid: { $gt: '' },
        'match.method': { $in: ['new', 'later'] },
      };
      if (route.toGate) q.entryGate = route.toGate;
      found.push(...(await this.sightings.find(q).select(FEATURE_FIELDS).limit(MAX_CANDIDATES).lean<SightingRow[]>()));
    }
    if (!found.length) return null;
    // only where a vehicle starts: a sighting with an earlier one of its vehicle already came from somewhere
    const starts = new Set(
      (await this.vehicles.find({ vid: { $in: [...new Set(found.map((x) => x.vid))] } }).select('vid first').lean()).map(
        (v) => v.first.sightingId,
      ),
    );
    const ranked = found
      .filter((x) => starts.has(x.sightingId) && x.vid !== ownVid)
      .map((x) => ({ x, score: scoreLinkCandidate(this.features(x), f) }))
      .filter((r): r is { x: SightingRow; score: number } => r.score !== null && r.score >= Math.min(this.cfg.accept, this.cfg.skipAccept))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_LATER);
    const pending = { ...self, vid: ownVid || PENDING } as SightingRow;
    for (const { x } of ranked) {
      const routes = net.upstream.get(String(x.cameraId)) ?? [];
      const m = await this.byRoutes(x, this.features(x), x.entryGate, routes, net, pending);
      // it picks this record (or another sighting of this record's vehicle, e.g. the other box's duplicate)
      if (m?.vid === pending.vid) return { sighting: x, match: { ...m, vid: ownVid, late: true } };
    }
    return null;
  }

  /** The best vehicle (its best sighting) if it clears `accept` and leads the next vehicle by `margin`. */
  private choose<T>(scored: Scored<T>[], vidOf: (t: T) => string, cfg: MatchSettings): { pick: Scored<T>; margin: number } | null {
    const perVehicle = new Map<string, Scored<T>>();
    for (const x of scored) {
      const had = perVehicle.get(vidOf(x.candidate));
      if (!had || x.score > had.score) perVehicle.set(vidOf(x.candidate), x);
    }
    const list = [...perVehicle.values()].sort((a, b) => b.score - a.score);
    const pick = pickBest(list, cfg);
    return pick ? { pick, margin: list.length > 1 ? pick.score - list[1].score : pick.score } : null;
  }

  /**
   * `from` turned out to be the same vehicle as `into` (a record arrived late): its sightings, violations and tickets
   * take `into`, the ID its first camera gave; `from` stays findable as an alias. The registry row adds up.
   */
  private async merge(from: string, into: string) {
    if (!from || from === into) return;
    const [a, b] = await Promise.all([this.vehicles.findOne({ vid: into }), this.vehicles.findOne({ vid: from }).lean()]);
    if (!a || !b) return;
    await Promise.all([
      this.sightings.updateMany({ vid: from }, { $set: { vid: into } }),
      this.violations.updateMany({ vid: from }, { $set: { vid: into } }),
      this.cases.updateMany({ vid: from }, { $set: { vid: into } }),
    ]);
    const add = (x: Record<string, number> = {}, y: Record<string, number> = {}) => {
      const out = { ...x };
      for (const [k, n] of Object.entries(y)) out[k] = (out[k] ?? 0) + n;
      return out;
    };
    const topOf = (votes: Record<string, number>) => Object.entries(votes).sort((p, q) => q[1] - p[1])[0]?.[0];
    a.classVotes = add(a.classVotes, b.classVotes);
    a.vehicleClass = topOf(a.classVotes) ?? a.vehicleClass;
    a.markModified('classVotes');
    a.appearanceVotes = add(a.appearanceVotes, b.appearanceVotes);
    a.markModified('appearanceVotes');
    const look = topOf(a.appearanceVotes);
    if (look && a.appearance?.text.toLowerCase() !== look) a.appearance = { text: look, ...parseAppearance(look) };
    if (plateRank(b.plateStatus) > plateRank(a.plateStatus)) {
      Object.assign(a, { registration: b.registration, regKey: b.regKey, numberKey: b.numberKey, plateStatus: b.plateStatus });
    } else if (!a.numberKey && b.numberKey) a.numberKey = b.numberKey;
    const na = a.embeddingCount ?? 0;
    const nb = b.embeddingCount ?? 0;
    const emb = mergeMeans(toFloats(a.embedding), na, toFloats(b.embedding), nb, 'l2');
    const col = mergeMeans(toFloats(a.colour), na, toFloats(b.colour), nb, 'l1');
    if (emb) a.embedding = toBuffer(emb);
    if (col) a.colour = toBuffer(col);
    a.embeddingCount = na + nb;
    if (new Date(b.first.at) < new Date(a.first.at)) a.first = b.first;
    if (new Date(b.last.at) > new Date(a.last.at)) a.last = b.last;
    a.sightings = (a.sightings ?? 0) + (b.sightings ?? 0);
    a.cameraCount = (await this.sightings.distinct('cameraId', { vid: into })).length;
    a.mergedVids = [...new Set([...(a.mergedVids ?? []), from, ...(b.mergedVids ?? [])])];
    await this.vehicles.deleteOne({ vid: from });
    await a.save();
    await this.refreshViolations(into);
    this.index.remove(from);
    if (emb) this.index.upsert(into, emb);
    this.logger.log(`${from} is ${into} (a record arrived late): joined`);
  }

  // ------------------------------------------------------------------------------------------ registry

  private async updateVehicle(
    vid: string,
    seq: number,
    s: SightingRow,
    f: SightingFeatures,
    firstAt: VehicleSeenAt,
    lastAt: VehicleSeenAt,
  ) {
    const cls = s.vehicleClass || '';
    const plate = s.plate;
    const plateFields =
      plate && plateRank(plate.status) > 0 && plate.registration
        ? { registration: plate.registration, regKey: s.regKey || '', numberKey: s.numberKey || '', plateStatus: plate.status }
        : null;
    if (seq) {
      await this.vehicles.create({
        vid,
        seq,
        vehicleClass: cls,
        classVotes: cls ? { [cls]: 1 } : {},
        ...(plateFields ?? { numberKey: s.numberKey || '' }),
        embedding: f.embedding ? toBuffer(f.embedding) : undefined,
        colour: f.colour ? toBuffer(f.colour) : undefined,
        embeddingCount: f.embedding ? 1 : 0,
        first: firstAt,
        last: lastAt,
        sightings: 1,
        cameraCount: 1,
      });
      if (f.embedding) this.index.upsert(vid, f.embedding);
      return;
    }
    const v = await this.vehicles.findOne({ vid });
    if (!v) return;
    if (cls) {
      const votes = { ...(v.classVotes ?? {}), [cls]: (v.classVotes?.[cls] ?? 0) + 1 };
      v.classVotes = votes;
      v.vehicleClass = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
      v.markModified('classVotes');
    }
    if (plateFields && plateRank(plateFields.plateStatus) > plateRank(v.plateStatus)) Object.assign(v, plateFields);
    else if (!v.numberKey && s.numberKey) v.numberKey = s.numberKey;
    let mean: Float32Array | undefined;
    if (f.embedding) {
      const n = v.embeddingCount ?? 0;
      mean = updateMean(toFloats(v.embedding), n, f.embedding, 'l2');
      v.embedding = toBuffer(mean);
      if (f.colour) v.colour = toBuffer(updateMean(toFloats(v.colour), n, f.colour, 'l1'));
      v.embeddingCount = n + 1;
    }
    if (new Date(lastAt.at) > new Date(v.last.at)) v.last = lastAt;
    if (new Date(firstAt.at) < new Date(v.first.at)) v.first = firstAt;
    v.sightings = (v.sightings ?? 0) + 1;
    v.cameraCount = (await this.sightings.distinct('cameraId', { vid })).length;
    await v.save();
    if (mean) this.index.upsert(vid, mean);
  }

  private async voteAppearance(vid: string, text: string) {
    const key = text.trim().toLowerCase().replace(/[.$]/g, '');
    if (!key) return;
    const v = await this.vehicles
      .findOneAndUpdate({ vid }, { $inc: { [`appearanceVotes.${key}`]: 1 } }, { new: true })
      .select('appearanceVotes appearance')
      .lean();
    if (!v) return;
    const [top] = Object.entries(v.appearanceVotes ?? {}).sort((a, b) => b[1] - a[1]);
    if (top && (!v.appearance || v.appearance.text.toLowerCase() !== top[0])) {
      await this.vehicles.updateOne(
        { vid },
        { $set: { appearance: { text: top[0] === key ? text.trim() : top[0], ...parseAppearance(top[0]) } } },
      );
    }
  }

  /** The vehicle's violations in this run (same track) get its ID, and so do their tickets. */
  private async linkViolations(s: SightingRow, vid: string) {
    if (!s.runId || s.trackId == null) return;
    const ids = (
      await this.violations.find({ runId: s.runId, trackId: s.trackId, vid: { $in: ['', null] } }).select('_id').lean()
    ).map((v) => v._id);
    if (!ids.length) return;
    await this.violations.updateMany({ _id: { $in: ids } }, { $set: { vid } });
    await this.cases.updateMany({ violationId: { $in: ids } }, { $set: { vid } });
    await this.refreshViolations(vid);
  }

  private async refreshViolations(vid: string) {
    const [count, last] = await Promise.all([
      this.violations.countDocuments({ vid }),
      this.violations.findOne({ vid }).sort({ occurredAt: -1 }).select('code title occurredAt cameraName').lean(),
    ]);
    await this.vehicles.updateOne(
      { vid },
      last
        ? {
            $set: {
              violations: count,
              lastViolation: { id: String(last._id), code: last.code, title: last.title, at: last.occurredAt, cameraName: last.cameraName },
            },
          }
        : { $set: { violations: count }, $unset: { lastViolation: 1 } },
    );
  }

  // ------------------------------------------------------------------------------------------ helpers

  private features(s: Partial<SightingRow>): SightingFeatures {
    return {
      cameraId: String(s.cameraId ?? ''),
      firstSeen: new Date(s.firstSeen ?? 0),
      lastSeen: new Date(s.lastSeen ?? s.firstSeen ?? 0),
      vehicleClass: s.vehicleClass ?? '',
      entry: pt(s.entry),
      exit: pt(s.exit),
      plateStatus: s.plate?.status,
      regKey: s.regKey,
      numberKey: s.numberKey,
      embedding: toFloats(s.embedding),
      colour: toFloats(s.colour),
      slot: s.slot,
    };
  }

  /** Cameras, gates and the road graph's routes (one or two links), cached; rebuilt when an admin changes a network. */
  private async cameraInfo(): Promise<CameraCache> {
    if (this.cache && Date.now() - this.cache.at < CAMERA_CACHE_MS) return this.cache;
    const rows = await this.cameras.find().select('name code network zones').lean();
    const cams = new Map<string, CameraInfo>();
    const graph: CameraLinks[] = [];
    for (const c of rows) {
      const id = String(c._id);
      const frame = c.network?.frameSize ?? ((c.zones as { frame_size?: number[] } | undefined)?.frame_size);
      cams.set(id, { id, name: c.name, code: c.code, gates: c.network?.gates ?? [], frameSize: frame });
      graph.push({ id, links: (c.network?.links ?? []).map((l) => ({ ...l, toCameraId: String(l.toCameraId ?? '') })) });
    }
    const upstream = new Map<string, Route[]>();
    const downstream = new Map<string, Route[]>();
    for (const r of routesOf(graph, this.cfg.skipDwellS)) {
      upstream.set(r.toCameraId, [...(upstream.get(r.toCameraId) ?? []), r]);
      downstream.set(r.fromCameraId, [...(downstream.get(r.fromCameraId) ?? []), r]);
    }
    this.cache = { at: Date.now(), cams, upstream, downstream };
    return this.cache;
  }

  private async nextSeq(): Promise<number> {
    const counters = this.connection.collection<{ _id: string; seq: number }>('counters');
    const r = await counters.findOneAndUpdate({ _id: 'vehicle-id' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    if (!r) throw new Error('Vehicle ID counter not available');
    return r.seq;
  }

  /**
   * Forgets every Vehicle ID and gives them again from the stored sightings, oldest first (after the matching
   * rules or the camera links changed). Officers' plates typed on violations are applied again.
   */
  async rebuild(): Promise<{ sightings: number }> {
    if (this.rebuilding) throw new Error('A rebuild is already running');
    this.rebuilding = true;
    try {
      await this.chain;
      await this.sightings.updateMany({}, { $set: { vid: '', entryGate: '', exitGate: '' }, $unset: { match: 1 } });
      await this.violations.updateMany({ vid: { $gt: '' } }, { $set: { vid: '' } });
      await this.cases.updateMany({ vid: { $gt: '' } }, { $set: { vid: '' } });
      await this.vehicles.deleteMany({});
      await this.connection.collection<{ _id: string; seq: number }>('counters').deleteOne({ _id: 'vehicle-id' });
      this.index.clear();
      this.cache = null;
      const total = await this.backfill();
      // an officer's plate on a violation beats any camera read
      for await (const v of this.violations.find({ vid: { $gt: '' }, registration: { $gt: '' } }).select('vid registration').lean().cursor()) {
        await this.onOfficerPlate(v.vid, v.registration);
      }
      return { sightings: total };
    } finally {
      this.rebuilding = false;
    }
  }

  private async backfill(): Promise<number> {
    const missing = { $or: [{ vid: '' }, { vid: { $exists: false } }] };
    try {
      const total = await this.sightings.countDocuments(missing);
      if (!total) return 0;
      this.logger.log(`Giving Vehicle IDs to ${total} earlier sightings, oldest first...`);
      let done = 0;
      for await (const s of this.sightings.find(missing).sort({ firstSeen: 1 }).select('sightingId').lean().cursor()) {
        await this.assign(s.sightingId).catch(() => null);
        if (++done % 500 === 0) this.logger.log(`Vehicle IDs: ${done} / ${total}`);
      }
      this.logger.log(`Vehicle IDs: ${done} earlier sightings done`);
      return done;
    } catch (err) {
      this.logger.warn(`Vehicle ID backfill stopped: ${(err as Error).message}`);
      return 0;
    }
  }
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}
