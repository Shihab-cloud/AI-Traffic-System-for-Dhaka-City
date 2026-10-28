import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { Payment, PaymentModel } from 'src/schemas/traffic/payment.schema';
import { PlateSighting, PlateSightingModel } from 'src/schemas/traffic/plate-sighting.schema';
import { Review, ReviewModel, ReviewStatusEnum } from 'src/schemas/traffic/review.schema';
import { TrafficCase, TrafficCaseModel } from 'src/schemas/traffic/traffic-case.schema';
import { Vehicle, VehicleModel } from 'src/schemas/traffic/vehicle.schema';
import { Violation, ViolationModel } from 'src/schemas/traffic/violation.schema';

type Count = { _id: string; n: number };

/** Numbers for the admin dashboard and the officer's reports. Days are Dhaka calendar days (UTC+6). */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(TrafficCase.name) private readonly cases: TrafficCaseModel,
    @InjectModel(Payment.name) private readonly payments: PaymentModel,
    @InjectModel(Review.name) private readonly reviews: ReviewModel,
    @InjectModel(PlateSighting.name) private readonly sightings: PlateSightingModel,
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
    @InjectModel(Vehicle.name) private readonly vehicles: VehicleModel,
    @InjectModel(User.name) private readonly users: UserModel,
  ) {}

  async overview(days = 30) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const inRange = { occurredAt: { $gte: since } };
    const day = { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: '+06:00' } };
    const [
      byDay, byCode, byStatus, byCamera, byClass, speed, caseStatus, revenue, revenueByDay, pendingReviews,
      topVehicles, sightings, cameras, vehicles, users,
    ] = await Promise.all([
      this.violations.aggregate<Count>([{ $match: inRange }, { $group: { _id: day, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      this.violations.aggregate<Count & { title: string }>([
        { $match: inRange },
        { $group: { _id: '$code', n: { $sum: 1 }, title: { $first: '$title' } } },
        { $sort: { _id: 1 } },
      ]),
      this.violations.aggregate<Count>([{ $match: inRange }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.violations.aggregate<Count & { name: string }>([
        { $match: inRange },
        { $group: { _id: '$cameraId', n: { $sum: 1 }, name: { $first: '$cameraName' } } },
        { $sort: { n: -1 } },
      ]),
      this.violations.aggregate<Count>([
        { $match: inRange },
        { $group: { _id: '$vehicleClass', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      this.violations.aggregate<{ _id: null; avg: number; max: number; overBy: number; n: number }>([
        { $match: { ...inRange, code: 'V2', kph: { $ne: null } } },
        {
          $group: {
            _id: null,
            avg: { $avg: { $ifNull: ['$avgKph', '$kph'] } },
            max: { $max: '$kph' },
            overBy: { $avg: { $subtract: [{ $ifNull: ['$avgKph', '$kph'] }, '$limitKph'] } },
            n: { $sum: 1 },
          },
        },
      ]),
      this.cases.aggregate<Count & { amount: number }>([
        { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      this.payments.aggregate<{ _id: null; amount: number; n: number }>([
        { $match: { status: 'succeeded' } },
        { $group: { _id: null, amount: { $sum: '$amount' }, n: { $sum: 1 } } },
      ]),
      this.payments.aggregate<{ _id: string; amount: number }>([
        { $match: { status: 'succeeded', paidAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: '+06:00' } },
            amount: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.reviews.countDocuments({ status: ReviewStatusEnum.PENDING }),
      this.cases.aggregate<Count & { amount: number }>([
        { $group: { _id: '$registration', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
        { $sort: { n: -1 } },
        { $limit: 5 },
      ]),
      this.sightings.countDocuments({ firstSeen: { $gte: since } }),
      this.cameras.countDocuments({ active: true }),
      this.vehicles.countDocuments(),
      this.users.countDocuments(),
    ]);

    // Every day in the range, zero-filled, so charts have no gaps.
    const series: { day: string; violations: number; revenue: number }[] = [];
    const vMap = new Map(byDay.map((d) => [d._id, d.n]));
    const rMap = new Map(revenueByDay.map((d) => [d._id, d.amount]));
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() + 6 * 3600 * 1000 - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      series.push({ day: d, violations: vMap.get(d) ?? 0, revenue: rMap.get(d) ?? 0 });
    }
    const caseMap = Object.fromEntries(caseStatus.map((c) => [c._id, { count: c.n, amount: c.amount }]));
    const issued = caseStatus.reduce((s, c) => s + c.n, 0);
    return {
      days,
      series,
      violations: {
        total: byDay.reduce((s, d) => s + d.n, 0),
        byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
        byCode: byCode.map((c) => ({ code: c._id, title: c.title, count: c.n })),
        // String: a raw ObjectId from an aggregation reaches the browser as {} (the page keys its rows by it)
        byCamera: byCamera.map((c) => ({ cameraId: c._id ? String(c._id) : null, name: c.name || 'Unknown', count: c.n })),
        byClass: byClass.map((c) => ({ vehicleClass: c._id || 'Unknown', count: c.n })),
        speed: speed[0]
          ? { count: speed[0].n, avgKph: Math.round(speed[0].avg), maxKph: Math.round(speed[0].max), avgOverKph: Math.round(speed[0].overBy) }
          : null,
      },
      cases: {
        issued,
        byStatus: caseMap,
        paidRate: issued ? (caseMap.paid?.count ?? 0) / issued : 0,
        outstanding: (caseMap.unpaid?.amount ?? 0) + (caseMap.under_review?.amount ?? 0),
      },
      revenue: { total: revenue[0]?.amount ?? 0, payments: revenue[0]?.n ?? 0 },
      pendingReviews,
      topVehicles: topVehicles.map((t) => ({ registration: t._id, cases: t.n, amount: t.amount })),
      plateSightings: sightings,
      activeCameras: cameras,
      registeredVehicles: vehicles,
      users,
    };
  }
}
