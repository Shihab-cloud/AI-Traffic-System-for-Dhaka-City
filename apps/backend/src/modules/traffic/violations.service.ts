import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter, Types } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { Fine, FineModel } from 'src/schemas/traffic/fine.schema';
import { TrafficCase, TrafficCaseModel } from 'src/schemas/traffic/traffic-case.schema';
import { Vehicle, VehicleModel } from 'src/schemas/traffic/vehicle.schema';
import {
  Violation,
  ViolationModel,
  ViolationStatusEnum,
} from 'src/schemas/traffic/violation.schema';
import { AuditService } from './audit.service';
import type { ViolationListQuery } from './dto/traffic.req';
import { ClipsService } from './clips.service';
import { EvidenceService } from './evidence.service';
import { numberKey, regKey, toPlain } from './traffic.util';
import { VehicleIdentityService } from './vehicle-identity.service';
import { VlmService } from './vlm.service';

@Injectable()
export class ViolationsService {
  constructor(
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(Vehicle.name) private readonly vehicles: VehicleModel,
    @InjectModel(Fine.name) private readonly fines: FineModel,
    @InjectModel(TrafficCase.name) private readonly cases: TrafficCaseModel,
    private readonly evidence: EvidenceService,
    private readonly vlm: VlmService,
    private readonly audit: AuditService,
    private readonly clips: ClipsService,
    private readonly identity: VehicleIdentityService,
  ) {}

  async list(q: ViolationListQuery) {
    const match: QueryFilter<Violation> = {};
    if (q.status && q.status !== 'all') match.status = q.status as ViolationStatusEnum;
    if (q.code) match.code = q.code;
    if (q.cameraId) match.cameraId = new Types.ObjectId(q.cameraId);
    if (q.from || q.to) {
      match.occurredAt = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    }
    if (q.search) {
      const key = regKey(q.search);
      const digits = q.search.replace(/\D/g, '');
      match.$or = [
        ...(key ? [{ regKey: { $regex: key } }] : []),
        ...(digits.length >= 2 ? [{ 'plate.number': { $regex: digits.replace(/(\d{2})(\d+)/, '$1-?$2') } }] : []),
        { vehicleClass: { $regex: `^${q.search.replace(/[^A-Za-z]/g, '')}`, $options: 'i' } },
      ];
    }
    const page = await this.violations.paginate(match, {
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      // Newest detection first. Not occurredAt: a recorded video's clock can be weeks old, which would put a
      // violation detected just now in the middle of the list.
      sort: { createdAt: -1, _id: -1 },
      lean: true,
      select: '-details -frameSize -bbox -source',
    });
    return { ...page, docs: page.docs.map((d) => toPlain(d)) };
  }

  /** Counts for the dashboard header and the sidebar badge. */
  async summary() {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [byStatus, today, byCode] = await Promise.all([
      this.violations.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      // When the system detected it: a recorded video's own clock (occurredAt) can be weeks old.
      this.violations.countDocuments({ createdAt: { $gte: since } }),
      this.violations.aggregate<{ _id: string; n: number }>([
        { $match: { status: ViolationStatusEnum.NEW } },
        { $group: { _id: '$code', n: { $sum: 1 } } },
      ]),
    ]);
    const status = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    return {
      new: status.new ?? 0,
      ticketed: status.ticketed ?? 0,
      dismissed: status.dismissed ?? 0,
      last24h: today,
      newByCode: Object.fromEntries(byCode.map((s) => [s._id, s.n])),
      latestAt: (await this.violations.findOne().sort({ createdAt: -1 }).select('createdAt').lean())?.createdAt,
    };
  }

  async get(id: string) {
    const v = await this.violations.findById(id).lean();
    if (!v) throw new NotFoundException('Violation not found');
    const read = v.registration || v.plate?.registration || '';
    const digits = numberKey(v.plate?.number || read);
    const clip = await this.clips.ensure(v).catch(() => v.clip);   // asked for here if it has none yet
    const [images, fine, trafficCase, exact, byNumber, video] = await Promise.all([
      this.evidence.sign(v.images),
      this.fines.findOne({ code: v.code }).lean(),
      v.caseId ? this.cases.findById(v.caseId).lean() : null,
      read ? this.vehicles.findOne({ regKey: regKey(read) }).lean() : null,
      this.vehicles.find({ numberKey: digits || '-' }).limit(5).lean(),
      this.clips.video(clip),
    ]);
    // Registry vehicles the plate may belong to: exact match first, then same six digits.
    const others = byNumber.filter((b) => !exact || String(b._id) !== String(exact._id));
    const candidates = (exact ? [exact, ...others] : others).map((c) => toPlain(c));
    return {
      ...toPlain<Record<string, unknown>>(v),
      images,
      fine: toPlain(fine),
      case: toPlain(trafficCase),
      vehicleMatches: candidates,
      vlmProvider: this.vlm.provider,
      video,
      videoStatus: clip?.status ?? 'none',
      videoError: clip?.status === 'failed' ? clip.error : undefined,
    };
  }

  async setPlate(id: string, registration: string, user: CurrentUser) {
    const v = await this.violations.findById(id);
    if (!v) throw new NotFoundException('Violation not found');
    if (v.status === ViolationStatusEnum.TICKETED) throw new ConflictException('A ticket was already sent');
    const before = v.registration || v.plate?.registration || '';
    v.registration = registration.trim();
    v.regKey = regKey(registration);
    await v.save();
    // the vehicle's plate across the camera network: an officer's entry beats any camera read
    if (v.vid) await this.identity.onOfficerPlate(v.vid, v.registration);
    await this.audit.record(user, 'violation.plate', 'violation', id, `Plate set to "${v.registration}"`, {
      before,
      after: v.registration,
    });
    return this.get(id);
  }

  async dismiss(id: string, reason: string, user: CurrentUser) {
    const v = await this.violations.findById(id);
    if (!v) throw new NotFoundException('Violation not found');
    if (v.status !== ViolationStatusEnum.NEW) throw new ConflictException(`Violation is already ${v.status}`);
    v.status = ViolationStatusEnum.DISMISSED;
    v.dismissReason = reason;
    v.reviewedById = new Types.ObjectId(user.id);
    v.reviewedAt = new Date();
    await v.save();
    await this.audit.record(user, 'violation.dismiss', 'violation', id, `Dismissed ${v.code}: ${reason}`);
    return this.get(id);
  }

  async reopen(id: string, user: CurrentUser) {
    const v = await this.violations.findById(id);
    if (!v) throw new NotFoundException('Violation not found');
    if (v.status !== ViolationStatusEnum.DISMISSED) throw new BadRequestException('Only dismissed violations reopen');
    v.status = ViolationStatusEnum.NEW;
    v.dismissReason = undefined;
    await v.save();
    await this.audit.record(user, 'violation.reopen', 'violation', id, `Reopened ${v.code}`);
    return this.get(id);
  }

  explain(id: string, force: boolean) {
    return this.vlm.request(id, force);
  }
}
