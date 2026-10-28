import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { PlateSighting, PlateSightingModel } from 'src/schemas/traffic/plate-sighting.schema';
import { TrafficCase, TrafficCaseModel } from 'src/schemas/traffic/traffic-case.schema';
import { Violation, ViolationModel } from 'src/schemas/traffic/violation.schema';
import { AuditService } from './audit.service';
import { EvidenceService } from './evidence.service';
import { numberKey, regKey, toPlain } from './traffic.util';

type TimelineItem = {
  kind: 'violation' | 'sighting';
  id: string;
  at: Date;
  until?: Date;
  cameraId?: string;
  cameraName: string;
  lat?: number;
  lng?: number;
  title: string;
  registration: string;
  plateStatus: string;
  vehicleClass: string;
  image?: string;
};

/**
 * Following a vehicle across cameras by plate: everywhere our cameras saw that registration (violations + the
 * passed-vehicle list, which before 2026-10-28 was the plate-tracking box's sightings). Following it by Vehicle ID
 * and appearance: VehicleSearchService.
 */
@Injectable()
export class TrackService {
  constructor(
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(PlateSighting.name) private readonly sightings: PlateSightingModel,
    @InjectModel(TrafficCase.name) private readonly cases: TrafficCaseModel,
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
    private readonly evidence: EvidenceService,
    private readonly audit: AuditService,
  ) {}

  async byPlate(query: string, user: CurrentUser) {
    const key = regKey(query);
    const digits = numberKey(query) || (query.replace(/\D/g, '').length === 6 ? query.replace(/\D/g, '') : '');
    if (key.length < 4 && !digits) throw new BadRequestException('Enter a registration or its 6-digit number');
    const numberPattern = digits ? `^${digits.slice(0, 2)}-${digits.slice(2)}$` : null;

    // Six digits alone also match full registrations ending in them (area / letter unknown or unread).
    const endsWith = digits ? [{ regKey: { $regex: `${digits}$` } }] : [];
    const vMatch: QueryFilter<Violation> = {
      $or: [{ regKey: key }, ...endsWith, ...(numberPattern ? [{ 'plate.number': { $regex: numberPattern } }] : [])],
    };
    const sMatch: QueryFilter<PlateSighting> = { $or: [{ regKey: key }, ...(digits ? [{ numberKey: digits }] : [])] };
    const [vs, ss, cs, cams] = await Promise.all([
      this.violations.find(vMatch).sort({ occurredAt: 1 }).limit(300).lean(),
      this.sightings.find(sMatch).sort({ firstSeen: 1 }).limit(300).lean(),
      this.cases.find({ $or: [{ regKey: key }, ...endsWith] }).sort({ issuedAt: -1 }).lean(),
      this.cameras.find().select('name code lat lng address').lean(),
    ]);
    const camById = new Map(cams.map((c) => [String(c._id), c]));
    const place = (id?: unknown) => {
      const c = id ? camById.get(String(id)) : undefined;
      return { cameraId: c ? String(c._id) : undefined, lat: c?.lat, lng: c?.lng };
    };

    const items: TimelineItem[] = [
      ...(await Promise.all(
        vs.map(async (v) => ({
          kind: 'violation' as const,
          id: String(v._id),
          at: v.occurredAt,
          cameraName: v.cameraName,
          ...place(v.cameraId),
          title: `${v.code} ${v.title}${v.code === 'V2' && v.kph != null ? ` (${v.avgKph ?? v.kph} km/h)` : ''}`,
          registration: v.registration || v.plate?.registration || '',
          plateStatus: v.registration ? 'set by officer' : v.plate?.status ?? '',
          vehicleClass: v.vehicleClass,
          image: (await this.evidence.sign(v.images.filter((i) => i.kind === 'closeup').slice(0, 1)))[0]?.url,
        })),
      )),
      ...(await Promise.all(
        ss.map(async (s) => ({
          kind: 'sighting' as const,
          id: String(s._id),
          at: s.firstSeen,
          until: s.lastSeen,
          cameraName: s.cameraName,
          ...place(s.cameraId),
          title: s.slot === 'plates' || !s.slot ? 'Seen by plate camera' : 'Passed the camera',
          registration: s.plate?.registration ?? '',
          plateStatus: s.plate?.status ?? '',
          vehicleClass: s.vehicleClass,
          image: (await this.evidence.sign(s.images.slice(0, 1)))[0]?.url,
        })),
      )),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    // Cameras in the order the vehicle reached them (consecutive repeats collapsed).
    const route: { cameraName: string; cameraId?: string; lat?: number; lng?: number; from: Date; to: Date; events: number }[] = [];
    for (const it of items) {
      const last = route[route.length - 1];
      if (last && last.cameraName === it.cameraName) {
        last.to = it.until ?? it.at;
        last.events += 1;
      } else {
        route.push({ cameraName: it.cameraName, cameraId: it.cameraId, lat: it.lat, lng: it.lng, from: it.at, to: it.until ?? it.at, events: 1 });
      }
    }
    await this.audit.record(user, 'track.search', 'vehicle', key || digits, `Tracked "${query}"`, {
      results: items.length,
    });
    return {
      query,
      regKey: key,
      numberKey: digits,
      timeline: items,
      route,
      cases: cs.map((c) => toPlain(c)),
    };
  }
}
