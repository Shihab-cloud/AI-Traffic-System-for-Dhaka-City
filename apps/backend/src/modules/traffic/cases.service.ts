import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter, Types } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { Fine, FineModel } from 'src/schemas/traffic/fine.schema';
import { Payment, PaymentModel } from 'src/schemas/traffic/payment.schema';
import { Review, ReviewModel, ReviewStatusEnum } from 'src/schemas/traffic/review.schema';
import {
  CaseStatusEnum,
  TrafficCase,
  TrafficCaseModel,
} from 'src/schemas/traffic/traffic-case.schema';
import { Vehicle, VehicleModel } from 'src/schemas/traffic/vehicle.schema';
import {
  Violation,
  ViolationModel,
  ViolationStatusEnum,
} from 'src/schemas/traffic/violation.schema';
import { NotificationChannelEnum } from 'src/shared/enums/notification-channel.enum';
import { MongoQueryBuilder } from 'src/utils/mongo-query-builder';
import { NotificationService } from '../notification/notification.service';
import { AuditService } from './audit.service';
import type { IssueTicketRequest, ListQuery, ReviewRequest } from './dto/traffic.req';
import { ClipsService } from './clips.service';
import { EvidenceService } from './evidence.service';
import { TrafficMailService } from './traffic-mail.service';
import { VehicleIdentityService } from './vehicle-identity.service';
import { VlmService } from './vlm.service';
import { isCompleteRegistration, makeNumber, money, regKey, toPlain } from './traffic.util';

const DAY = 24 * 3600 * 1000;

/** Tickets ("cases"): issuing them from violations, the owner's view, and review requests. */
@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name);
  private readonly currency: string;

  constructor(
    @InjectModel(TrafficCase.name) private readonly cases: TrafficCaseModel,
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(Vehicle.name) private readonly vehicles: VehicleModel,
    @InjectModel(Fine.name) private readonly fines: FineModel,
    @InjectModel(Review.name) private readonly reviews: ReviewModel,
    @InjectModel(Payment.name) private readonly payments: PaymentModel,
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
    @InjectModel(User.name) private readonly users: UserModel,
    private readonly evidence: EvidenceService,
    private readonly mail: TrafficMailService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly vlm: VlmService,
    private readonly clips: ClipsService,
    private readonly identity: VehicleIdentityService,
    config: ConfigService,
  ) {
    this.currency = config.get<string>('CURRENCY') ?? 'BDT';
  }

  // ---------------------------------------------------------------- issuing

  async issue(violationId: string, dto: IssueTicketRequest, officer: CurrentUser) {
    const v = await this.violations.findById(violationId);
    if (!v) throw new NotFoundException('Violation not found');
    if (v.status !== ViolationStatusEnum.NEW) throw new ConflictException(`Violation is already ${v.status}`);

    const registration = (dto.registration ?? v.registration ?? '').trim();
    if (!isCompleteRegistration(registration)) {
      throw new BadRequestException(
        'Enter the full registration (area, letter and number, e.g. "Dhaka Metro-Ga 11-5431") before sending a ticket',
      );
    }
    const key = regKey(registration);
    const fine = await this.fines.findOne({ code: v.code, active: true }).lean();
    if (!fine) throw new BadRequestException(`No active fine for ${v.code}: set one in Admin > Fines`);

    const vehicle = await this.vehicles.findOne({ regKey: key }).lean();
    const ownerEmail = (vehicle?.ownerEmail || dto.ownerEmail || '').toLowerCase();
    if (!ownerEmail) {
      throw new BadRequestException(
        `${registration} is not in the vehicle registry: add it there, or enter the owner's email`,
      );
    }
    const ownerUser = vehicle?.ownerUserId
      ? await this.users.findById(vehicle.ownerUserId).lean()
      : await this.users.findOne({ email: ownerEmail }).lean();

    const issuedAt = new Date();
    let created: TrafficCase | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        created = await this.cases.create({
          caseNumber: makeNumber('DTE', issuedAt),
          violationId: v._id,
          registration,
          regKey: key,
          vehicleId: vehicle?._id,
          ownerName: vehicle?.ownerName || dto.ownerName || '',
          ownerEmail,
          ownerUserId: ownerUser?._id,
          code: v.code,
          title: fine.title || v.title,
          amount: fine.amount,
          currency: this.currency,
          legalReference: fine.legalReference,
          status: CaseStatusEnum.UNPAID,
          issuedAt,
          dueDate: new Date(issuedAt.getTime() + fine.dueDays * DAY),
          issuedById: new Types.ObjectId(officer.id),
          issuedByName: officer.email ?? '',
          officerNote: dto.note ?? '',
          vid: v.vid ?? '',
        });
      } catch (err) {
        const code = (err as { code?: number; keyPattern?: Record<string, number> }).code;
        const pattern = (err as { keyPattern?: Record<string, number> }).keyPattern ?? {};
        if (code === 11000 && pattern.violationId) throw new ConflictException('A ticket was already sent');
        if (code !== 11000) throw err;
      }
    }
    if (!created) throw new ConflictException('Could not allocate a case number, try again');

    v.status = ViolationStatusEnum.TICKETED;
    v.registration = registration;
    v.regKey = key;
    v.caseId = created._id as unknown as Types.ObjectId;
    v.reviewedById = new Types.ObjectId(officer.id);
    v.reviewedAt = issuedAt;
    await v.save();
    if (v.vid) await this.identity.onOfficerPlate(v.vid, registration);

    try {
      await this.mail.ticket(created, v);
      created.emailedAt = new Date();
    } catch (err) {
      created.emailError = (err as Error).message;
      this.logger.error(`Ticket email for ${created.caseNumber} failed: ${created.emailError}`);
    }
    await this.cases.updateOne(
      { _id: created._id },
      { $set: { emailedAt: created.emailedAt, emailError: created.emailError } },
    );
    if (ownerUser) {
      await this.notify(String(ownerUser._id), `Traffic violation ${created.caseNumber}`,
        `${created.title} recorded for ${registration}. Fine ${money(created.amount, created.currency)}.`, {
          caseId: String(created._id),
        });
    }
    await this.audit.record(officer, 'violation.ticket', 'case', String(created._id),
      `Ticket ${created.caseNumber} sent to ${ownerEmail} for ${registration} (${v.code})`, {
        violationId,
        amount: created.amount,
      });
    return toPlain(await this.cases.findById(created._id).lean());
  }

  /** Sends the ticket email again (e.g. the mail server was down, or the owner lost it). */
  async resendTicket(id: string, officer: CurrentUser) {
    const c = await this.cases.findById(id);
    if (!c) throw new NotFoundException('Case not found');
    const v = await this.violations.findById(c.violationId);
    if (!v) throw new NotFoundException('Violation not found');
    try {
      await this.mail.ticket(c, v);
    } catch (err) {
      c.emailError = (err as Error).message;
      await c.save();
      throw new BadRequestException(`Email not sent: ${c.emailError}`);
    }
    c.emailedAt = new Date();
    c.emailError = undefined;
    await c.save();
    await this.audit.record(officer, 'case.resend', 'case', id, `Ticket email for ${c.caseNumber} sent again`);
    return toPlain(c);
  }

  async notify(userId: string, title: string, message: string, metadata: Record<string, unknown>) {
    try {
      await this.notifications.publishNotification({
        channel: NotificationChannelEnum.TO_USER,
        payload: { userId, title, message, metadata },
        overrides: { email: false, push: true },
      });
    } catch (err) {
      this.logger.warn(`In-app notification failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- staff views

  async list(q: ListQuery) {
    const match: QueryFilter<TrafficCase> = {};
    if (q.status && q.status !== 'all') match.status = q.status as CaseStatusEnum;
    Object.assign(match, MongoQueryBuilder.buildSearch(q.search, TrafficCase));
    const page = await this.cases.paginate(match, {
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      sort: { issuedAt: -1 },
      lean: true,
    });
    const now = Date.now();
    return {
      ...page,
      docs: page.docs.map((d) => ({
        ...toPlain<Record<string, unknown>>(d),
        overdue: d.status === CaseStatusEnum.UNPAID && new Date(d.dueDate).getTime() < now,
      })),
    };
  }

  /** Full case with evidence: for staff, and (after the ownership check) for the owner. */
  async detail(id: string) {
    const c = await this.cases.findById(id).lean();
    if (!c) throw new NotFoundException('Case not found');
    const v = await this.violations.findById(c.violationId).lean();
    // The owner reads the explanation too: start one if the ticket was sent before there was one (request() also
    // restarts a pending one that was lost). Not after a failure: the page would retry on every poll.
    if (v && (!v.vlm || v.vlm.status === 'pending')) {
      await this.vlm.request(String(v._id)).catch((err: Error) => this.logger.warn(`Explanation: ${err.message}`));
    }
    // The violation clip: asked for here if it has none yet (violations from before clips existed).
    const clip = v ? await this.clips.ensure(v).catch((err: Error) => this.logger.warn(`Clip: ${err.message}`)) : undefined;
    const [images, camera, reviews, payments, vehicle, video] = await Promise.all([
      this.evidence.sign(v?.images ?? []),
      v?.cameraId ? this.cameras.findById(v.cameraId).select('name code address lat lng').lean() : null,
      this.reviews.find({ caseId: c._id }).sort({ createdAt: -1 }).lean(),
      this.payments.find({ caseId: c._id }).sort({ createdAt: -1 }).select('-userId').lean(),
      c.vehicleId ? this.vehicles.findById(c.vehicleId).select('registration vehicleClass makeModel colour').lean() : null,
      this.clips.video(clip ?? undefined),
    ]);
    const overdue = c.status === CaseStatusEnum.UNPAID && new Date(c.dueDate).getTime() < Date.now();
    return {
      ...toPlain<Record<string, unknown>>(c),
      overdue,
      violation: v
        ? {
            id: String(v._id),
            code: v.code,
            title: v.title,
            vehicleClass: v.vehicleClass,
            occurredAt: v.occurredAt,
            zone: v.zone,
            kph: v.kph,
            avgKph: v.avgKph,
            limitKph: v.limitKph,
            details: v.details,
            plate: v.plate,
            explanation: v.vlm?.status === 'done' ? v.vlm.explanation : undefined,
            explanationProvider: v.vlm?.status === 'done' ? v.vlm.provider : undefined,
            explanationStatus: v.vlm?.status === 'failed' ? 'failed' : v.vlm?.status === 'done' ? 'done' : 'pending',
            explanationUsedClip: v.vlm?.status === 'done' ? !!v.vlm.usedClip : undefined,
          }
        : null,
      images,
      video,
      /** none: no clip can be made (live camera); pending: being made; failed: see videoError */
      videoStatus: clip?.status ?? 'none',
      videoError: clip?.status === 'failed' ? clip.error : undefined,
      camera: toPlain(camera),
      vehicle: toPlain(vehicle),
      reviews: reviews.map((r) => toPlain(r)),
      payments: payments.map((p) => toPlain(p)),
    };
  }

  // ---------------------------------------------------------------- owner (citizen) views

  private ownerFilter(user: CurrentUser): QueryFilter<TrafficCase> {
    const or: QueryFilter<TrafficCase>[] = [{ ownerUserId: new Types.ObjectId(user.id) }];
    if (user.email) or.push({ ownerEmail: user.email.toLowerCase() });
    return { $or: or };
  }

  /** The owner's cases; cases sent to their email before they registered are linked to their account here. */
  async mine(user: CurrentUser) {
    if (user.email) {
      await this.cases.updateMany(
        { ownerEmail: user.email.toLowerCase(), ownerUserId: { $exists: false } },
        { $set: { ownerUserId: new Types.ObjectId(user.id) } },
      );
    }
    const rows = await this.cases.find(this.ownerFilter(user)).sort({ issuedAt: -1 }).lean();
    return rows.map((c) => ({
      ...toPlain<Record<string, unknown>>(c),
      overdue: c.status === CaseStatusEnum.UNPAID && new Date(c.dueDate).getTime() < Date.now(),
    }));
  }

  async assertOwner(user: CurrentUser, caseId: string) {
    const c = await this.cases.findOne({ _id: caseId, ...this.ownerFilter(user) });
    if (!c) throw new ForbiddenException('This case is not yours, or it does not exist');
    return c;
  }

  async mineDetail(user: CurrentUser, caseId: string) {
    await this.assertOwner(user, caseId);
    const d = await this.detail(caseId);
    return { ...d, officerNote: undefined, issuedByName: undefined };
  }

  async requestReview(user: CurrentUser, caseId: string, dto: ReviewRequest) {
    const c = await this.assertOwner(user, caseId);
    if (c.status !== CaseStatusEnum.UNPAID) {
      throw new ConflictException(
        c.status === CaseStatusEnum.UNDER_REVIEW ? 'A review is already in progress' : `The case is ${c.status}`,
      );
    }
    if (await this.reviews.exists({ caseId: c._id, status: ReviewStatusEnum.REJECTED })) {
      throw new ConflictException('A review of this case was already decided; it cannot be reviewed again');
    }
    const review = await this.reviews.create({
      caseId: c._id,
      caseNumber: c.caseNumber,
      userId: new Types.ObjectId(user.id),
      userEmail: user.email ?? '',
      reason: dto.reason,
      details: dto.details,
    });
    c.status = CaseStatusEnum.UNDER_REVIEW;
    await c.save();
    await this.audit.record(user, 'review.request', 'case', String(c._id), `Review requested for ${c.caseNumber}`, {
      reason: dto.reason,
    });
    return toPlain(review);
  }

  // ---------------------------------------------------------------- reviews (staff)

  async listReviews(q: ListQuery) {
    const match: QueryFilter<Review> = {};
    if (q.status && q.status !== 'all') match.status = q.status as ReviewStatusEnum;
    const page = await this.reviews.paginate(match, {
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      sort: { createdAt: -1 },
      lean: true,
      populate: { path: 'caseId', select: 'caseNumber registration code title amount currency status ownerName' },
    });
    return { ...page, docs: page.docs.map((d) => toPlain(d)) };
  }

  async decideReview(id: string, decision: 'accepted' | 'rejected', note: string, officer: CurrentUser) {
    const r = await this.reviews.findById(id);
    if (!r) throw new NotFoundException('Review not found');
    if (r.status !== ReviewStatusEnum.PENDING) throw new ConflictException(`Review is already ${r.status}`);
    const c = await this.cases.findById(r.caseId);
    if (!c) throw new NotFoundException('Case not found');

    r.status = decision === 'accepted' ? ReviewStatusEnum.ACCEPTED : ReviewStatusEnum.REJECTED;
    r.decidedById = new Types.ObjectId(officer.id);
    r.decidedByName = officer.email ?? '';
    r.decidedAt = new Date();
    r.decisionNote = note;
    await r.save();

    if (decision === 'accepted') {
      c.status = CaseStatusEnum.CANCELLED;
    } else {
      c.status = CaseStatusEnum.UNPAID;
      // The owner gets at least a week from the decision to pay.
      c.dueDate = new Date(Math.max(new Date(c.dueDate).getTime(), Date.now() + 7 * DAY));
    }
    await c.save();

    try {
      await this.mail.reviewDecision(c, r);
    } catch (err) {
      this.logger.error(`Review decision email failed: ${(err as Error).message}`);
    }
    if (c.ownerUserId) {
      await this.notify(String(c.ownerUserId), `Review ${r.status}: ${c.caseNumber}`,
        decision === 'accepted' ? 'Your ticket was cancelled.' : 'Your review was rejected; the fine is due.',
        { caseId: String(c._id) });
    }
    await this.audit.record(officer, 'review.decide', 'review', id, `Review of ${c.caseNumber} ${r.status}`, {
      note,
    });
    return toPlain(r);
  }
}
