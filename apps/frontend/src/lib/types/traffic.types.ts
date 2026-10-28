/** Shapes returned by the backend's traffic module (`apps/backend/src/modules/traffic`). */

/** mongoose-paginate result, as the traffic endpoints return it. */
export interface Page<T> {
  docs: T[];
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export type ViolationStatus = 'new' | 'ticketed' | 'dismissed';
export type CaseStatus = 'unpaid' | 'under_review' | 'paid' | 'cancelled';
export type SourceKind = 'ip' | 'webcam' | 'file' | 'upload';
/** The surveillance boxes. Both read the plates of their violators; the plate box ("plates", every vehicle's plate)
 * was merged into the speed box on 2026-10-28, and its old runs keep that slot name. */
export type SlotName = 'speed' | 'violations';

export interface EvidenceImage {
  kind: string;
  key: string;
  caption?: string;
  url?: string;
}

export interface PlateRead {
  registration: string;
  number: string;
  area: string;
  metro: boolean;
  letter: string;
  status: string;
  confidence: number;
  agreeingReads: number;
  plateWidthPx: number;
}

/** local = model run on this computer by the vision service; rules = no model, text from the measurements. */
export type VlmProvider = 'local' | 'anthropic' | 'rules';

export interface VlmExplanation {
  status: 'pending' | 'done' | 'failed';
  provider: VlmProvider;
  model?: string;
  explanation?: string;
  supportsViolation?: 'yes' | 'no' | 'unclear';
  vehicleDescription?: string;
  concerns?: string[];
  error?: string;
  /** the explanation also looked at frames of the violation clip */
  usedClip?: boolean;
}

/** 15 s of video around the violation, the vehicle boxed in red (signed URL). */
export interface ViolationVideo {
  url: string;
  /** the vehicle was followed in the clip and boxed */
  marked: boolean;
  fromS?: number;
  toS?: number;
  atS?: number;
}
/** none: no clip can be made (live camera); pending: being made; failed: see videoError */
export type VideoStatus = 'none' | 'pending' | 'done' | 'failed';

export interface Violation {
  id: string;
  eventId: string;
  code: string;
  title: string;
  status: ViolationStatus;
  trackId: number;
  /** Vehicle ID across the camera network (DV-000123); '' until the vehicle has left the view */
  vid?: string;
  vehicleClass: string;
  classConfidence?: number;
  kph?: number;
  avgKph?: number;
  limitKph?: number;
  zone: string;
  areas: string[];
  cameraId?: string;
  cameraName: string;
  slot: string;
  occurredAt: string;
  videoTimeS?: number;
  details?: Record<string, unknown>;
  images: EvidenceImage[];
  plate?: PlateRead;
  registration: string;
  vlm?: VlmExplanation;
  dismissReason?: string;
  caseId?: string;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  registration: string;
  vehicleClass: string;
  makeModel: string;
  colour: string;
  ownerName: string;
  ownerEmail?: string;
  ownerPhone: string;
  ownerAddress: string;
}

export interface Fine {
  id: string;
  code: string;
  title: string;
  amount: number;
  dueDays: number;
  legalReference: string;
  description: string;
  active: boolean;
}

export interface TrafficCase {
  id: string;
  caseNumber: string;
  violationId: string;
  /** Vehicle ID across the camera network (DV-000123) */
  vid?: string;
  registration: string;
  ownerName: string;
  ownerEmail?: string;
  code: string;
  title: string;
  amount: number;
  currency: string;
  legalReference: string;
  status: CaseStatus;
  issuedAt: string;
  dueDate: string;
  issuedByName?: string;
  officerNote?: string;
  paidAt?: string;
  invoiceNumber?: string;
  emailedAt?: string;
  emailError?: string;
  overdue?: boolean;
}

export interface ViolationDetail extends Violation {
  fine: Fine | null;
  case: TrafficCase | null;
  vehicleMatches: Vehicle[];
  vlmProvider: VlmProvider;
  video: ViolationVideo | null;
  videoStatus: VideoStatus;
  videoError?: string;
}

export interface Review {
  id: string;
  caseId: string | (Partial<TrafficCase> & { _id: string });
  caseNumber: string;
  userEmail: string;
  reason: string;
  details: string;
  status: 'pending' | 'accepted' | 'rejected';
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  caseNumber: string;
  amount: number;
  currency: string;
  /** sslcommerz | sandbox (built-in test payment) */
  provider: string;
  method: string;
  account: string;
  /** pending: an SSLCommerz checkout not finished; voided: a test payment undone when its case was reset */
  status: 'pending' | 'succeeded' | 'failed' | 'voided';
  transactionId: string;
  failureReason?: string;
  invoiceNumber?: string;
  payerName: string;
  payerEmail: string;
  paidAt?: string;
  createdAt: string;
}

export interface CaseDetail extends TrafficCase {
  violation: {
    id: string;
    code: string;
    title: string;
    vehicleClass: string;
    occurredAt: string;
    zone: string;
    kph?: number;
    avgKph?: number;
    limitKph?: number;
    details?: Record<string, unknown>;
    plate?: PlateRead;
    explanation?: string;
    explanationProvider?: string;
    /** pending: being written (the page polls until it is done); failed: none (the officer can explain again) */
    explanationStatus?: 'done' | 'pending' | 'failed';
    /** the explanation also looked at the video clip */
    explanationUsedClip?: boolean;
  } | null;
  images: EvidenceImage[];
  video: ViolationVideo | null;
  videoStatus?: VideoStatus;
  videoError?: string;
  camera: { name: string; code: string; address: string; lat?: number; lng?: number } | null;
  vehicle: Partial<Vehicle> | null;
  reviews: Review[];
  payments: Payment[];
}

export interface CameraSource {
  kind: SourceKind;
  value: string;
}

export interface ZoneConfig {
  name: string;
  type?: string;
  points: [number, number][];
  width_m?: number;
  length_m?: number;
  road_category?: string;
  allowed_direction?: string;
  speed_limit_kph?: number | null;
  banned_classes?: string[];
  stopping_allowed?: boolean;
  /** bus_stop only: an officially approved mid-block bus bay (counts even far from an intersection) */
  approved?: boolean;
  /** road only: "auto" = size from automatic calibration (speeding flagged only beyond its uncertainty) */
  scale_source?: 'measured' | 'auto';
  speed_uncertainty_pct?: number | null;
  /** road only, automatic zones: lanes seen in traffic */
  lanes?: number;
}

/** What automatic zone learning found (CSE499B surveillance/autozone.py `report`). */
export interface AutoZoneReport {
  observed_s: number;
  moving_vehicles: number;
  road_direction_agreement?: number;
  calibration?: {
    lens: string;
    hfov_deg: number;
    camera_height_m: number;
    tilt_deg: number;
    speed_uncertainty_pct: number;
    warning?: string;
  };
  carriageways?: { direction: string; width_m: number; lanes: number; vehicles: number; kerbs: string[] }[];
  found?: { intersections?: number; uturns?: number; signal_queues?: number; bus_stops?: number };
  notes: string[];
}

/** One frame of a source, to draw zones on. */
export interface CameraFrame {
  /** data URL (JPEG) */
  image: string;
  width: number;
  height: number;
  /** time of this frame in the video (a time past its end wraps around to the start) */
  atSec: number;
  /** video length; null for live cameras */
  durationSec: number | null;
}

export interface CameraZones {
  frame_size: [number, number];
  zones: ZoneConfig[];
  lane_lines?: { name: string; points: [number, number][] }[];
  peak_hours?: [string, string][] | null;
  /** Per-rule settings that replace the engine's defaults, e.g. `{road_blocking: {dwell_sec: 30}}`. */
  rules?: Record<string, Record<string, unknown>>;
  /** Present when the zones were learned automatically (kept after edits, as a record). */
  auto?: { version: number; report: AutoZoneReport; reference_t?: number | null };
}

/** Automatic zone learning job in the vision service. */
export interface AutoZoneStatus {
  state: 'idle' | 'starting' | 'observing' | 'analysing' | 'done' | 'error' | 'cancelled';
  message?: string;
  progress?: number;
  seconds?: number;
  movingVehicles?: number;
  source?: { kind: string; label: string };
  result?: { config: CameraZones; report: AutoZoneReport } | null;
}

export interface Camera {
  id: string;
  name: string;
  code: string;
  address: string;
  lat?: number;
  lng?: number;
  defaultSource?: CameraSource;
  zones?: CameraZones;
  speedLimitKph: number;
  active: boolean;
  notes: string;
  /** Traffic direction seen per road zone by the last "other violations" run. */
  learning?: {
    zones: Record<string, { toward: number; away: number; suggestion: 'both' | 'toward_camera' | 'away_from_camera' | null }>;
    runId: string;
    at: string;
  };
  /** Its place in the camera network (multi-camera tracking). */
  network?: CameraNetwork;
}

/** An area of a camera's picture where vehicles enter or leave its view (pixel corners at the network's frame size). */
export interface CameraGate {
  id: string;
  name: string;
  points: [number, number][];
}

/** "Leaving through fromGate, a vehicle reaches camera toCameraId's gate toGate after minS..maxS seconds." */
export interface CameraLink {
  fromGate: string;
  toCameraId: string;
  toGate: string;
  minS: number;
  maxS: number;
  distanceM?: number;
}

export interface CameraNetwork {
  frameSize?: [number, number];
  gates: CameraGate[];
  links: CameraLink[];
}

export type VehicleSearchMode = 'id' | 'plate' | 'appearance';

/** A vehicle as the whole camera network knows it (one Vehicle ID across cameras). */
export interface TrackedVehicleRow {
  vid: string;
  vehicleClass: string;
  registration: string;
  plateStatus: string;
  appearance: string;
  first: { cameraName?: string; cameraCode?: string; at?: string };
  last: { cameraId?: string; cameraName?: string; cameraCode?: string; at?: string; gate?: string };
  sightings: number;
  cameraCount: number;
  violations: number;
  lastViolation?: { id: string; code: string; title: string; at: string; cameraName: string };
  /** IDs found later to be this vehicle and joined to it */
  mergedVids?: string[];
  image?: string;
}

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

export interface VehicleSearchResult extends Page<TrackedVehicleRow> {
  by: VehicleSearchMode;
  colour: string;
  type: string;
}

/** How a sighting got its Vehicle ID. */
export interface VehicleMatch {
  method: 'plate' | 'link' | 'same-camera' | 'new' | 'later';
  score?: number;
  margin?: number;
  candidates?: number;
  fromSightingId?: string;
  fromCameraName?: string;
  travelS?: number;
  /** 2: over two links, the camera in between (`viaCameraName`) missed the vehicle */
  hops?: number;
  viaCameraName?: string;
  /** found when the earlier camera's record arrived after this one */
  late?: boolean;
  toSightingId?: string;
  toCameraName?: string;
  at: string;
}

export interface VehicleTimelineItem extends TimelineItem {
  cameraCode?: string;
  trackId?: number;
  slot?: string;
  status?: string;
  appearance?: string;
  entryGate?: string;
  exitGate?: string;
  match?: VehicleMatch;
}

export interface VehicleTrack {
  vehicle: TrackedVehicleRow;
  route: {
    cameraName: string;
    cameraId?: string;
    cameraCode?: string;
    lat?: number;
    lng?: number;
    from: string;
    to: string;
    events: number;
    violations: number;
  }[];
  timeline: VehicleTimelineItem[];
  cases: TrafficCase[];
  /** the ID asked for, when it was joined to this vehicle */
  mergedFrom?: string;
}

/** Vehicles that look like one vehicle (appearance index), most alike first. */
export interface SimilarVehicles {
  vid: string;
  when: 'after' | 'any';
  after: string;
  indexed: number;
  ms: number;
  docs: (TrackedVehicleRow & { score: number })[];
}

export interface SlotRun {
  runId: string;
  slot: SlotName;
  state: 'starting' | 'running' | 'finished' | 'stopped' | 'error';
  error: string;
  source: { kind: SourceKind; label: string; live: boolean };
  camera: { id?: string; name?: string; code?: string };
  startedAt: number;
  endedAt: number | null;
  progress: { frames?: number; total?: number; fps?: number; vehicles?: number; violations?: number; plates?: number };
  stats: { violations?: number; plates?: number; sightings?: number };
}

export interface SlotStatus {
  slot: SlotName;
  title: string;
  busy: boolean;
  run: SlotRun | null;
  status: string;
  log: string[];
  frameSize: [number, number] | null;
  history: SlotRun[];
  urls: { stream: string; snapshot: string };
}

export interface SurveillanceStatus {
  online: boolean;
  slots: SlotStatus[];
  delivery: { sent: number; rejected: number; pending: number; lastError: string } | null;
}

export interface VideoFile {
  name: string;
  path: string;
  folder: string;
  sizeMb: number;
  modified: string;
  kind: 'file' | 'upload';
}

export interface TimelineItem {
  kind: 'violation' | 'sighting';
  id: string;
  at: string;
  until?: string;
  cameraId?: string;
  cameraName: string;
  lat?: number;
  lng?: number;
  title: string;
  registration: string;
  plateStatus: string;
  vehicleClass: string;
  image?: string;
}

/** One row of the passed-vehicle list: a vehicle the other-violations box saw pass a camera. */
export interface PassedVehicle {
  id: string;
  /** the tracker's vehicle id in that run */
  trackId: number;
  /** Vehicle ID across the camera network (DV-000123); '' until assigned */
  vid: string;
  vehicleClass: string;
  registration: string;
  plateStatus: string;
  plateWidthPx: number;
  firstSeen: string;
  lastSeen: string;
  /** two words from the local vision-language model, e.g. "grey SUV"; pending while a box runs */
  appearance: { status: 'pending' | 'done' | 'failed'; text: string } | null;
  cameraName: string;
  runId: string;
  vehicleImage: string;
  plateImage: string;
  evidenceImage: string;
}

export interface PassedVehicleCamera {
  id: string;
  name: string;
  code: string;
  address: string;
  vehicles: number;
  lastAt: string | null;
}

export interface PassedVehicleRun {
  runId: string;
  vehicles: number;
  /** vehicles whose look is still waiting for the model */
  describing: number;
  from: string;
  to: string;
  startedAt: string | null;
  state: string;
  slot: string;
  source: string;
}

export interface PlateTrack {
  query: string;
  timeline: TimelineItem[];
  route: { cameraName: string; cameraId?: string; lat?: number; lng?: number; from: string; to: string; events: number }[];
  cases: TrafficCase[];
}

export interface Overview {
  days: number;
  series: { day: string; violations: number; revenue: number }[];
  violations: {
    total: number;
    byStatus: Partial<Record<ViolationStatus, number>>;
    byCode: { code: string; title: string; count: number }[];
    byCamera: { cameraId: string | null; name: string; count: number }[];
    byClass: { vehicleClass: string; count: number }[];
    speed: { count: number; avgKph: number; maxKph: number; avgOverKph: number } | null;
  };
  cases: {
    issued: number;
    byStatus: Partial<Record<CaseStatus, { count: number; amount: number }>>;
    paidRate: number;
    outstanding: number;
  };
  revenue: { total: number; payments: number };
  pendingReviews: number;
  topVehicles: { registration: string; cases: number; amount: number }[];
  plateSightings: number;
  activeCameras: number;
  registeredVehicles: number;
  users: number;
}

export interface AuditEntry {
  id: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface SurveillanceRunRow {
  id: string;
  runId: string;
  slot: SlotName | 'plates';
  cameraName: string;
  state: string;
  error: string;
  source?: { kind: string; value: string };
  startedAt?: string;
  endedAt?: string;
  stats: Record<string, number>;
  startedByName: string;
}
