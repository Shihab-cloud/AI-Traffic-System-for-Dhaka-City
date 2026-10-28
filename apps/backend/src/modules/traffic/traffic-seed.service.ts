import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import { Fine, FineModel } from 'src/schemas/traffic/fine.schema';

/**
 * Default fine schedule (codes match the violation engine). The amounts are placeholders for the admin to set:
 * check each against the Road Transport Act 2018 and fill in the legal reference before real use.
 */
const DEFAULT_FINES = [
  { code: 'V1', title: 'Bus stopped outside a bus stop', amount: 3000 },
  { code: 'V2', title: 'Over speed limit', amount: 5000 },
  { code: 'V3', title: 'Parked at a no-parking kerb', amount: 5000 },
  { code: 'V4', title: 'Wrong-side driving', amount: 10000 },
  { code: 'V5', title: 'Crossing a solid lane line', amount: 3000 },
  { code: 'V6', title: 'Riding without a helmet', amount: 1000 },
  { code: 'V7', title: 'Blocking a running lane', amount: 5000 },
  { code: 'V8', title: 'Vehicle class banned on this road', amount: 5000 },
];

/**
 * The Kakoli overpass camera of the project recordings (Part-2, 2560x1440): the two road zones of
 * speed_zones.json, with the traffic directions the violation run measured (right side toward the camera,
 * left side away from it).
 */
const DEMO_CAMERA = {
  name: 'Kakoli overpass (Part-2 recording)',
  code: 'KAK-01',
  address: 'Kakoli, Banani, Dhaka',
  lat: 23.7937,
  lng: 90.4007,
  speedLimitKph: 60,
  // the project's recording, in a VIDEO_DIRS folder (vision/.env); any other video can be picked in the portal
  defaultSource: { kind: 'file' as const, value: 'C:\\path\\to\\your\\videos\\kakoli__TimeVideo_20260922_173615_Part-2.mp4' },
  notes: 'Zone sizes from speed_zones.json (how they were measured is not recorded: verify on site).',
  zones: {
    frame_size: [2560, 1440],
    zones: [
      {
        name: 'Right side',
        type: 'road',
        points: [[1340, 200], [1505, 196], [2508, 932], [1458, 908]],
        width_m: 10.5,
        length_m: 90,
        road_category: 'city',
        allowed_direction: 'toward_camera',
        speed_limit_kph: null,
        banned_classes: [],
        stopping_allowed: false,
      },
      {
        name: 'left side',
        type: 'road',
        points: [[1110, 173], [1312, 196], [1263, 921], [247, 772]],
        width_m: 14,
        length_m: 90,
        road_category: 'city',
        allowed_direction: 'away_from_camera',
        speed_limit_kph: null,
        banned_classes: [],
        stopping_allowed: false,
      },
      // Areas drawn by the CSE499B team for this view (CSE499B-Implimentation/violation_zones.json).
      {
        name: 'East kerb (crowd side)',
        type: 'no_parking',
        points: [[1489.1, 196.4], [1552.8, 194.8], [3490.2, 1319.6], [2852.1, 1291.4]],
      },
      { name: 'West kerb', type: 'no_parking', points: [[1067.2, 168.1], [1124.3, 174.6], [23.8, 1002.4], [-325.4, 946.8]] },
      {
        name: 'Side-road junction (west)',
        type: 'intersection',
        points: [[883.2, 271.0], [1103.8, 297.4], [965.8, 468.4], [611.3, 423.0]],
      },
      {
        name: 'West bus stop after junction',
        type: 'bus_stop',
        points: [[1004.9, 203.0], [1066.8, 210.1], [993.7, 262.9], [914.4, 253.5]],
        approved: false,
      },
    ],
    lane_lines: [],
    peak_hours: [['07:00', '10:30'], ['16:00', '20:30']],
  },
};

@Injectable()
export class TrafficSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TrafficSeedService.name);

  constructor(
    @InjectModel(Fine.name) private readonly fines: FineModel,
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
  ) {}

  async onApplicationBootstrap() {
    // Only missing codes are added: amounts an admin changed are never reset.
    for (const f of DEFAULT_FINES) {
      const res = await this.fines.updateOne(
        { code: f.code },
        {
          $setOnInsert: {
            ...f,
            dueDays: 30,
            legalReference: '',
            description: 'Default amount: check it against the Road Transport Act 2018 before use.',
            active: true,
          },
        },
        { upsert: true },
      );
      if (res.upsertedCount) this.logger.log(`Added default fine ${f.code} (${f.amount})`);
    }
    if ((await this.cameras.estimatedDocumentCount()) === 0) {
      await this.cameras.create({ ...DEMO_CAMERA, active: true });
      this.logger.log(`Added demo camera ${DEMO_CAMERA.code}`);
    }
  }
}
