import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { Fine, FineModel } from 'src/schemas/traffic/fine.schema';
import { Vehicle, VehicleModel } from 'src/schemas/traffic/vehicle.schema';
import { Violation, ViolationModel } from 'src/schemas/traffic/violation.schema';
import { MongoQueryBuilder } from 'src/utils/mongo-query-builder';
import { AuditService } from './audit.service';
import type { CameraRequest, FineRequest, ListQuery, VehicleRequest } from './dto/traffic.req';
import { numberKey, regKey, toPlain } from './traffic.util';
import { VehicleIdentityService } from './vehicle-identity.service';

type ZoneDict = {
  name?: unknown;
  type?: unknown;
  points?: unknown;
  width_m?: unknown;
  length_m?: unknown;
};

/** Admin-maintained reference data: cameras (with zones), the vehicle registry, the fine schedule. */
@Injectable()
export class RegistryService {
  constructor(
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
    @InjectModel(Vehicle.name) private readonly vehicles: VehicleModel,
    @InjectModel(Fine.name) private readonly fines: FineModel,
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(User.name) private readonly users: UserModel,
    private readonly audit: AuditService,
    private readonly identity: VehicleIdentityService,
  ) {}

  // ---------------------------------------------------------------- cameras

  /** Same checks the pipelines make when they load a zone file, so a bad zone fails here, not at start. */
  private validateZones(zones?: Record<string, unknown>) {
    if (!zones) return;
    const list = zones.zones;
    if (!Array.isArray(list)) throw new BadRequestException('zones.zones must be a list');
    const names = new Set<string>();
    for (const z of list as ZoneDict[]) {
      const name = typeof z.name === 'string' ? z.name.trim() : '';
      if (!name) throw new BadRequestException('Every zone needs a name');
      if (names.has(name)) throw new BadRequestException(`Two zones are called "${name}"`);
      names.add(name);
      const pts = z.points;
      if (
        !Array.isArray(pts) ||
        pts.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== 'number'))
      ) {
        throw new BadRequestException(`Zone "${name}": points must be [x, y] pairs`);
      }
      if ((z.type ?? 'road') === 'road') {
        if (pts.length !== 4)
          throw new BadRequestException(`Road zone "${name}" needs exactly 4 corners`);
        // The size may be left empty (0): the other-violations box then estimates it from vehicle sizes. The speed
        // box only uses road zones with a measured size.
        if ([z.width_m, z.length_m].some((v) => v != null && !(Number(v) >= 0))) {
          throw new BadRequestException(
            `Road zone "${name}": width and length must be metres (or empty)`,
          );
        }
      } else if (pts.length < 3) {
        throw new BadRequestException(`Area "${name}" needs at least 3 points`);
      }
    }
    const size = zones.frame_size;
    if (!Array.isArray(size) || size.length !== 2 || size.some((n) => !(Number(n) > 0))) {
      throw new BadRequestException(
        'zones.frame_size must be [width, height] of the frame the zones were drawn on',
      );
    }
  }

  async listCameras(all = true) {
    const rows = await this.cameras
      .find(all ? {} : { active: true })
      .sort({ name: 1 })
      .lean();
    return rows.map((c) => toPlain(c));
  }

  async getCamera(id: string) {
    const c = await this.cameras.findById(id).lean();
    if (!c) throw new NotFoundException('Camera not found');
    return toPlain(c);
  }

  async saveCamera(dto: CameraRequest, user: CurrentUser, id?: string) {
    this.validateZones(dto.zones);
    try {
      const doc = id
        ? await this.cameras.findByIdAndUpdate(
            id,
            { $set: dto },
            { returnDocument: 'after', runValidators: true },
          )
        : await this.cameras.create(dto);
      if (!doc) throw new NotFoundException('Camera not found');
      await this.audit.record(
        user,
        id ? 'camera.update' : 'camera.create',
        'camera',
        String(doc._id),
        `${id ? 'Updated' : 'Added'} camera ${doc.code} (${doc.name})`,
      );
      return toPlain(doc);
    } catch (err) {
      if ((err as { code?: number }).code === 11000)
        throw new ConflictException(`Camera code ${dto.code} is taken`);
      throw err;
    }
  }

  /** Zones only: what officers may change from the surveillance page (the rest of the camera stays admin-only). */
  async saveZones(id: string, zones: Record<string, unknown>, user: CurrentUser) {
    this.validateZones(zones);
    const doc = await this.cameras.findByIdAndUpdate(
      id,
      { $set: { zones } },
      { returnDocument: 'after' },
    );
    if (!doc) throw new NotFoundException('Camera not found');
    const list = (zones.zones as { type?: string }[]) ?? [];
    await this.audit.record(
      user,
      'camera.zones',
      'camera',
      id,
      `Zones of ${doc.code} saved: ${list.filter((z) => (z.type ?? 'road') === 'road').length} road zones, ` +
        `${list.filter((z) => (z.type ?? 'road') !== 'road').length} areas, ` +
        `${(zones.lane_lines as unknown[] | undefined)?.length ?? 0} lane lines`,
    );
    return toPlain(doc);
  }

  /**
   * Its place in the camera network (multi-camera tracking): gates on its picture and links to the next cameras.
   * Checked here so a typo cannot silently break matching: every link needs a gate of this camera (or none: any
   * gate), an existing other camera, and 0 <= minS < maxS <= 6 h.
   */
  async saveNetwork(id: string, raw: Record<string, unknown>, user: CurrentUser) {
    const cam = await this.cameras.findById(id).select('code').lean();
    if (!cam) throw new NotFoundException('Camera not found');
    const frameSize = Array.isArray(raw.frameSize) && raw.frameSize.length === 2 ? raw.frameSize.map(Number) : undefined;
    if (frameSize && !frameSize.every((n) => Number.isFinite(n) && n > 0)) throw new BadRequestException('Bad frame size');
    const gatesIn = Array.isArray(raw.gates) ? raw.gates : [];
    if (gatesIn.length > 24) throw new BadRequestException('At most 24 gates per camera');
    const gates = gatesIn.map((g, i) => {
      const r = (g ?? {}) as { id?: unknown; name?: unknown; points?: unknown };
      const gid = String(r.id ?? '').trim();
      const name = String(r.name ?? '').trim() || gid;
      const points = Array.isArray(r.points) ? r.points : [];
      if (!/^[A-Za-z0-9_-]{1,24}$/.test(gid)) throw new BadRequestException(`Gate ${i + 1}: its id must be 1-24 letters, digits, - or _`);
      if (points.length < 3 || points.length > 32) throw new BadRequestException(`Gate "${name}" needs 3 to 32 corners`);
      const pts = points.map((p) => (Array.isArray(p) ? p.slice(0, 2).map(Number) : []));
      if (!pts.every((p) => p.length === 2 && p.every((n) => Number.isFinite(n) && n >= 0))) {
        throw new BadRequestException(`Gate "${name}" has a corner that is not [x, y] in pixels`);
      }
      return { id: gid, name, points: pts.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) };
    });
    if (new Set(gates.map((g) => g.id)).size !== gates.length) throw new BadRequestException('Two gates have the same id');
    const gateIds = new Set(gates.map((g) => g.id));

    const linksIn = Array.isArray(raw.links) ? raw.links : [];
    if (linksIn.length > 48) throw new BadRequestException('At most 48 links per camera');
    const targets = new Map(
      (await this.cameras.find().select('code network.gates').lean()).map((c) => [String(c._id), c]),
    );
    const links = linksIn.map((l, i) => {
      const r = (l ?? {}) as Record<string, unknown>;
      const fromGate = String(r.fromGate ?? '');
      const toCameraId = String(r.toCameraId ?? '');
      const toGate = String(r.toGate ?? '');
      const minS = Number(r.minS);
      const maxS = Number(r.maxS);
      const target = targets.get(toCameraId);
      if (fromGate && !gateIds.has(fromGate)) throw new BadRequestException(`Link ${i + 1}: this camera has no gate "${fromGate}"`);
      if (!target || toCameraId === id) throw new BadRequestException(`Link ${i + 1}: choose another camera`);
      if (toGate && !(target.network?.gates ?? []).some((g) => g.id === toGate)) {
        throw new BadRequestException(`Link ${i + 1}: ${target.code} has no gate "${toGate}" (draw it there first)`);
      }
      if (!(minS >= 0 && maxS > minS && maxS <= 6 * 3600)) {
        throw new BadRequestException(`Link ${i + 1}: travel time must be 0 <= min < max <= 6 h (in seconds)`);
      }
      const distanceM = Number(r.distanceM);
      return {
        fromGate,
        toCameraId,
        toGate,
        minS: Math.round(minS),
        maxS: Math.round(maxS),
        ...(Number.isFinite(distanceM) && distanceM > 0 ? { distanceM: Math.round(distanceM) } : {}),
      };
    });

    const doc = await this.cameras.findByIdAndUpdate(
      id,
      { $set: { network: { ...(frameSize ? { frameSize } : {}), gates, links } } },
      { returnDocument: 'after' },
    );
    this.identity.invalidateCameras();
    await this.audit.record(user, 'camera.network', 'camera', id, `Network of ${cam.code}: ${gates.length} gates, ${links.length} links`);
    return toPlain(doc);
  }

  async deleteCamera(id: string, user: CurrentUser) {
    const c = await this.cameras.findById(id);
    if (!c) throw new NotFoundException('Camera not found');
    if (await this.violations.exists({ cameraId: c._id })) {
      // Evidence refers to it: keep the record, take it out of service.
      c.active = false;
      await c.save();
      await this.audit.record(
        user,
        'camera.deactivate',
        'camera',
        id,
        `Deactivated camera ${c.code}`,
      );
      return { deactivated: true };
    }
    await c.deleteOne();
    await this.audit.record(user, 'camera.delete', 'camera', id, `Deleted camera ${c.code}`);
    return { deleted: true };
  }

  // ---------------------------------------------------------------- vehicles

  async listVehicles(q: ListQuery) {
    const match: QueryFilter<Vehicle> = { ...MongoQueryBuilder.buildSearch(q.search, Vehicle) };
    const page = await this.vehicles.paginate(match, {
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      sort: { registration: 1 },
      lean: true,
    });
    return { ...page, docs: page.docs.map((d) => toPlain(d)) };
  }

  /** Registry rows for a registration: exact, else the same six digits (plate reads often miss area/letter). */
  async lookup(registration: string) {
    const exact = await this.vehicles.findOne({ regKey: regKey(registration) }).lean();
    if (exact) return { exact: toPlain(exact), similar: [] };
    const digits = numberKey(registration) || registration.replace(/\D/g, '');
    const similar =
      digits.length === 6 ? await this.vehicles.find({ numberKey: digits }).limit(10).lean() : [];
    return { exact: null, similar: similar.map((s) => toPlain(s)) };
  }

  async saveVehicle(dto: VehicleRequest, user: CurrentUser, id?: string) {
    const key = regKey(dto.registration);
    if (key.length < 6) throw new BadRequestException('Registration is too short');
    const email = dto.ownerEmail?.toLowerCase();
    const owner = email ? await this.users.findOne({ email }).select('_id').lean() : null;
    const data = {
      ...dto,
      ownerEmail: email,
      regKey: key,
      numberKey: numberKey(dto.registration),
      ownerUserId: owner?._id,
    };
    try {
      const doc = id
        ? await this.vehicles.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after' })
        : await this.vehicles.create(data);
      if (!doc) throw new NotFoundException('Vehicle not found');
      await this.audit.record(
        user,
        id ? 'vehicle.update' : 'vehicle.create',
        'vehicle',
        String(doc._id),
        `${id ? 'Updated' : 'Registered'} ${doc.registration} (${doc.ownerName})`,
      );
      return toPlain(doc);
    } catch (err) {
      if ((err as { code?: number }).code === 11000)
        throw new ConflictException(`${dto.registration} is already registered`);
      throw err;
    }
  }

  async deleteVehicle(id: string, user: CurrentUser) {
    const v = await this.vehicles.findByIdAndDelete(id);
    if (!v) throw new NotFoundException('Vehicle not found');
    await this.audit.record(
      user,
      'vehicle.delete',
      'vehicle',
      id,
      `Removed ${v.registration} from the registry`,
    );
    return { deleted: true };
  }

  /** Vehicles registered to the signed-in owner's email. */
  async myVehicles(user: CurrentUser) {
    if (!user.email) return [];
    const rows = await this.vehicles
      .find({ $or: [{ ownerEmail: user.email.toLowerCase() }, { ownerUserId: user.id }] })
      .select('registration vehicleClass makeModel colour')
      .lean();
    return rows.map((r) => toPlain(r));
  }

  // ---------------------------------------------------------------- fines

  async listFines() {
    const rows = await this.fines.find().sort({ code: 1 }).lean();
    return rows.map((f) => toPlain(f));
  }

  async saveFine(code: string, dto: FineRequest, user: CurrentUser) {
    const before = await this.fines.findOne({ code }).lean();
    const doc = await this.fines.findOneAndUpdate(
      { code },
      { $set: { ...dto, code } },
      {
        upsert: true,
        returnDocument: 'after',
      },
    );
    await this.audit.record(
      user,
      'fine.update',
      'fine',
      code,
      `Fine for ${code} set to ${dto.amount}`,
      {
        before: before ? { amount: before.amount, dueDays: before.dueDays } : null,
      },
    );
    return toPlain(doc);
  }
}
