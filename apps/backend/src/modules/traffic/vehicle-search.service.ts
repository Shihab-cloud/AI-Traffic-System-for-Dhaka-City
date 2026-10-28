import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, QueryFilter, Types } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { PlateSighting, PlateSightingModel } from 'src/schemas/traffic/plate-sighting.schema';
import { TrackedVehicle, TrackedVehicleModel } from 'src/schemas/traffic/tracked-vehicle.schema';
import { TrafficCase, TrafficCaseModel } from 'src/schemas/traffic/traffic-case.schema';
import { Violation, ViolationModel } from 'src/schemas/traffic/violation.schema';
import { AppearanceIndexService } from './appearance-index.service';
import { AuditService } from './audit.service';
import { EvidenceService } from './evidence.service';
import { numberKey, regKey, toPlain } from './traffic.util';
import {
  appearanceScore,
  classPenalty,
  parseAppearance,
  parseVid,
  plateBonus,
  type SightingFeatures,
  toFloats,
} from './vehicle-matching';

export type VehicleSearchMode = 'id' | 'plate' | 'appearance';

export interface VehicleSearchParams {
  q?: string;
  by?: VehicleSearchMode;
  colour?: string;
  type?: string;
  vehicleClass?: string;
  cameraId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/** "11-5431", "Dhaka Metro-Ga 11-5431", "115431" are plates; "DV-000123", "DV123", "123" are Vehicle IDs. */
export function searchMode(text: string): VehicleSearchMode {
  const t = text.trim();
  if (!t) return 'appearance';
  if (/^dv/i.test(t)) return 'id';
  const digits = t.replace(/\D/g, '');
  if (/^\d+$/.test(t)) return digits.length === 6 ? 'plate' : 'id';
  return /\d/.test(t) ? 'plate' : 'appearance';
}

/**
 * Finding a vehicle in the whole camera network, by Vehicle ID (first), plate or appearance. Every search is an
 * index lookup on `tracked_vehicles` (one row per vehicle, its last camera kept on it): O(log n) for n vehicles,
 * plus the rows returned, newest first. A vehicle's route reads its own sightings through the (vid, firstSeen)
 * index: O(log n + its sightings).
 */
@Injectable()
export class VehicleSearchService {
  constructor(
    @InjectModel(TrackedVehicle.name) private readonly vehicles: TrackedVehicleModel,
    @InjectModel(PlateSighting.name) private readonly sightings: PlateSightingModel,
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(TrafficCase.name) private readonly cases: TrafficCaseModel,
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
    private readonly evidence: EvidenceService,
    private readonly audit: AuditService,
    private readonly index: AppearanceIndexService,
  ) {}

  /** A vehicle by its ID, or by an ID that was joined to it (`mergedVids`). */
  private findByVid(vid: string, select: string) {
    return this.vehicles.findOne({ $or: [{ vid }, { mergedVids: vid }] }).select(select).lean();
  }

  async search(p: VehicleSearchParams, user: CurrentUser) {
    const text = (p.q ?? '').trim();
    const by = p.by ?? searchMode(text);
    const match: QueryFilter<TrackedVehicle> = {};
    const looks = by === 'appearance' ? parseAppearance(text) : { colour: '', type: '' };

    if (by === 'id') {
      const vid = parseVid(text);
      if (!vid) throw new BadRequestException('A Vehicle ID looks like DV-000123');
      match.$or = [{ vid }, { mergedVids: vid }];
    } else if (by === 'plate') {
      const key = regKey(text);
      const digits = numberKey(text) || (/^\d{6}$/.test(text.replace(/\D/g, '')) ? text.replace(/\D/g, '') : '');
      if (key.length < 4 && !digits) throw new BadRequestException('Enter a registration or its 6-digit number');
      match.$or = [{ regKey: key }, ...(digits ? [{ numberKey: digits }] : [])];
    }
    const colour = (p.colour || looks.colour).toLowerCase();
    const type = (p.type || looks.type).toLowerCase();
    if (colour) match['appearance.colour'] = colour;
    if (type) match['appearance.type'] = type;
    if (p.vehicleClass) match.vehicleClass = p.vehicleClass;
    if (p.cameraId && isValidObjectId(p.cameraId)) match['last.cameraId'] = new Types.ObjectId(p.cameraId);
    if (p.from || p.to) {
      match['last.at'] = { ...(p.from ? { $gte: new Date(p.from) } : {}), ...(p.to ? { $lte: new Date(p.to) } : {}) };
    }

    const limit = Math.min(Math.max(Number(p.limit) || 20, 1), 100);
    const res = await this.vehicles.paginate(match, {
      page: Math.max(Number(p.page) || 1, 1),
      limit,
      sort: { 'last.at': -1 },
      lean: true,
      select: '-embedding -colour -classVotes -appearanceVotes',
    });
    if (text) {
      await this.audit.record(user, 'track.vehicle-search', 'vehicle', text, `Searched vehicles by ${by}: "${text}"`, {
        results: res.totalDocs,
      });
    }
    return { ...res, by, colour, type, docs: await this.rows(res.docs as TrackedVehicle[]) };
  }

  /** A vehicle with everything the network knows: where it was seen last, its route, sightings, violations, tickets. */
  async detail(vidText: string, user: CurrentUser) {
    const asked = parseVid(vidText);
    if (!asked) throw new BadRequestException('A Vehicle ID looks like DV-000123');
    const v = await this.findByVid(asked, '-embedding -colour');
    if (!v) throw new NotFoundException(`No vehicle ${asked}`);
    const vid = v.vid;
    const [ss, vs, cs, cams] = await Promise.all([
      this.sightings.find({ vid }).sort({ firstSeen: 1 }).limit(500).select('-embedding -colour').lean(),
      this.violations.find({ vid }).sort({ occurredAt: 1 }).limit(300).lean(),
      this.cases.find({ vid }).sort({ issuedAt: -1 }).lean(),
      this.cameras.find().select('name code lat lng address').lean(),
    ]);
    const camById = new Map(cams.map((c) => [String(c._id), c]));
    const place = (id?: unknown) => {
      const c = id ? camById.get(String(id)) : undefined;
      return { cameraId: c ? String(c._id) : undefined, cameraCode: c?.code, lat: c?.lat, lng: c?.lng };
    };
    const firstImage = async (images: { kind: string; key: string; caption?: string }[], kinds: string[]) => {
      const img = kinds.map((k) => images.find((i) => i.kind === k)).find(Boolean);
      return img ? (await this.evidence.sign([img]))[0]?.url : undefined;
    };

    const timeline = [
      ...(await Promise.all(
        ss.map(async (s) => ({
          kind: 'sighting' as const,
          id: String(s._id),
          at: s.firstSeen,
          until: s.lastSeen,
          cameraName: s.cameraName,
          ...place(s.cameraId),
          title: 'Passed the camera',
          trackId: s.trackId,
          slot: s.slot,
          registration: s.plate?.registration ?? '',
          plateStatus: s.plate?.status ?? '',
          vehicleClass: s.vehicleClass,
          appearance: s.appearance?.status === 'done' ? s.appearance.text ?? '' : '',
          entryGate: s.entryGate,
          exitGate: s.exitGate,
          match: s.match,
          image: await firstImage(s.images, ['vehicle', 'evidence']),
        })),
      )),
      ...(await Promise.all(
        vs.map(async (x) => ({
          kind: 'violation' as const,
          id: String(x._id),
          at: x.occurredAt,
          cameraName: x.cameraName,
          ...place(x.cameraId),
          title: `${x.code} ${x.title}${x.code === 'V2' && x.kph != null ? ` (${x.avgKph ?? x.kph} km/h)` : ''}`,
          trackId: x.trackId,
          status: x.status,
          registration: x.registration || x.plate?.registration || '',
          plateStatus: x.registration ? 'set by officer' : x.plate?.status ?? '',
          vehicleClass: x.vehicleClass,
          image: await firstImage(x.images, ['closeup', 'scene']),
        })),
      )),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    // cameras in the order the vehicle reached them (consecutive records at one camera collapsed)
    const route: { cameraName: string; cameraId?: string; cameraCode?: string; lat?: number; lng?: number; from: Date; to: Date; events: number; violations: number }[] = [];
    for (const it of timeline) {
      const last = route[route.length - 1];
      const until = 'until' in it && it.until ? it.until : it.at;
      if (last && last.cameraName === it.cameraName) {
        if (new Date(until) > new Date(last.to)) last.to = until;
        last.events += 1;
        if (it.kind === 'violation') last.violations += 1;
      } else {
        route.push({
          cameraName: it.cameraName,
          cameraId: it.cameraId,
          cameraCode: it.cameraCode,
          lat: it.lat,
          lng: it.lng,
          from: it.at,
          to: until,
          events: 1,
          violations: it.kind === 'violation' ? 1 : 0,
        });
      }
    }
    await this.audit.record(user, 'track.vehicle', 'vehicle', vid, `Tracked ${vid}`, { sightings: ss.length });
    const [row] = await this.rows([v as TrackedVehicle]);
    return {
      vehicle: row,
      ...(asked !== vid ? { mergedFrom: asked } : {}),
      route,
      timeline,
      cases: cs.map((c) => toPlain(c)),
    };
  }

  /**
   * Vehicles anywhere in the network that look like this one: its mean appearance vector against the HNSW index of
   * every vehicle's (O(log n) per query, not a scan), then the nearest re-scored with colour, class and plate, as the
   * camera links do. `after`: only vehicles first seen after this one was last seen (where it may have gone when its
   * ID chain broke). Suggestions for an officer to check by the photos; IDs are never joined from this alone.
   */
  async similar(vidText: string, when: 'after' | 'any', limit: number, user: CurrentUser) {
    const asked = parseVid(vidText);
    if (!asked) throw new BadRequestException('A Vehicle ID looks like DV-000123');
    const v = await this.findByVid(asked, 'vid vehicleClass embedding colour regKey numberKey plateStatus first last');
    if (!v) throw new NotFoundException(`No vehicle ${asked}`);
    const emb = toFloats(v.embedding);
    if (!emb) {
      throw new BadRequestException(`${v.vid} has no appearance vector (listed before multi-camera tracking, or without the appearance model)`);
    }
    const n = Math.min(Math.max(limit || 10, 1), 30);
    const feat = (x: Partial<TrackedVehicle>): SightingFeatures => ({
      cameraId: '',
      firstSeen: new Date(0),
      lastSeen: new Date(0),
      vehicleClass: x.vehicleClass ?? '',
      plateStatus: x.plateStatus,
      regKey: x.regKey,
      numberKey: x.numberKey,
      embedding: toFloats(x.embedding),
      colour: toFloats(x.colour),
    });
    const me = feat(v);
    const since = new Date(v.last.at).getTime();
    const t0 = process.hrtime.bigint();
    // nearest first; a time filter can leave few of them: ask for more until enough pass (or the index is used up)
    let k = 8 * n;
    let picked: { v: TrackedVehicle; score: number; similarity: number }[] = [];
    for (;;) {
      const hits = this.index.nearest(emb, k).filter((h) => h.key !== v.vid);
      const sim = new Map(hits.map((h) => [h.key, h.similarity]));
      const rows = await this.vehicles
        .find({ vid: { $in: hits.map((h) => h.key) } })
        .select('-classVotes -appearanceVotes')
        .lean<TrackedVehicle[]>();
      picked = [];
      for (const c of rows) {
        if (when === 'after' && new Date(c.first.at).getTime() <= since) continue;
        const cf = feat(c);
        const cls = classPenalty(me.vehicleClass, cf.vehicleClass);
        const plate = plateBonus(me, cf);
        const app = appearanceScore(me, cf);
        if (cls === null || plate === null || app === null) continue;
        picked.push({ v: c, score: app + cls + plate, similarity: sim.get(c.vid) ?? 0 });
      }
      if (picked.length >= n || k >= this.index.size || k >= 6400) break;
      k *= 4;
    }
    picked.sort((a, b) => b.score - a.score);
    picked = picked.slice(0, n);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    await this.audit.record(user, 'track.vehicle-lookalikes', 'vehicle', v.vid, `Looked for vehicles like ${v.vid}`, {
      when,
      results: picked.length,
    });
    const rows = await this.rows(picked.map((p) => p.v));
    return {
      vid: v.vid,
      when,
      after: v.last.at,
      indexed: this.index.size,
      ms: Math.round(ms * 10) / 10,
      docs: rows.map((r, i) => ({ ...r, score: Math.round(picked[i].score * 1000) / 1000 })),
    };
  }

  /** List rows: the vehicle and its last sighting's picture. */
  private async rows(vs: TrackedVehicle[]) {
    const ids = vs.map((v) => v.last?.sightingId).filter(Boolean);
    const lastSightings = await this.sightings.find({ sightingId: { $in: ids } }).select('sightingId images').lean();
    const imgBy = new Map(lastSightings.map((s) => [s.sightingId, s.images]));
    return Promise.all(
      vs.map(async (v) => {
        const images = imgBy.get(v.last?.sightingId) ?? [];
        const img = images.find((i) => i.kind === 'vehicle') ?? images.find((i) => i.kind === 'evidence');
        return {
          vid: v.vid,
          vehicleClass: v.vehicleClass,
          registration: v.registration,
          plateStatus: v.plateStatus,
          appearance: v.appearance?.text ?? '',
          first: { cameraName: v.first?.cameraName, cameraCode: v.first?.cameraCode, at: v.first?.at },
          last: {
            cameraId: v.last?.cameraId ? String(v.last.cameraId) : undefined,
            cameraName: v.last?.cameraName,
            cameraCode: v.last?.cameraCode,
            at: v.last?.at,
            gate: v.last?.gate,
          },
          sightings: v.sightings,
          cameraCount: v.cameraCount,
          violations: v.violations,
          lastViolation: v.lastViolation,
          mergedVids: v.mergedVids ?? [],
          image: img ? (await this.evidence.sign([img]))[0]?.url : undefined,
        };
      }),
    );
  }
}
