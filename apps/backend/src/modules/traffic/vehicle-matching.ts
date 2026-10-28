/**
 * Multi-camera vehicle identity: the pure parts (no database), shared by VehicleIdentityService and its tests.
 *
 * Every vehicle the system sees gets one Vehicle ID (DV-000123) the first time a camera lists it; every later
 * sighting, at that camera or any other, is attached to the same ID. Following Liu et al., "City-Scale Multi-Camera
 * Vehicle Tracking Guided by Crossroad Zones" (AI City 2021, 1st place), a new sighting is never compared with every
 * vehicle (O(n^2)): only with the few that can physically be it.
 *  - Gates (the paper's crossroad zones): areas of a camera's picture where vehicles enter or leave its view.
 *  - Links: "a vehicle leaving camera A through gate g reaches camera B's gate h after minS..maxS seconds".
 *  - Candidates (the paper's direction-based temporal mask): the vehicles that left a linked upstream gate inside the
 *    travel-time window, read from an index on (camera, exit gate, exit time): O(log n + k), k = the vehicles on that
 *    one road link in that window, whatever the number of cameras.
 *  - Scoring (appearance, plate, class, timing) of the k candidates; the best one above ACCEPT, clearly ahead of the
 *    runner-up, keeps its ID, otherwise the vehicle gets a new one.
 *  - From a design note on city-scale tracking (2026-10-29, compared with this one): routes over two links when a
 *    camera in between missed the vehicle (routesOf), records that arrive out of order (VehicleIdentityService), and
 *    an HNSW index for the officers' look-alike search (appearance-index.ts). Not taken from it: a stream partitioned
 *    by vehicle ID (for appearance matching the ID is the result, not known on arrival), a hash store in place of
 *    MongoDB's indexes (O(1) vs O(log n) lookups, no gain worth a second copy of the data), and the global vector
 *    search giving IDs by itself (without place and time, lookalikes are too many).
 */

export type Pt = [number, number];

/** A gate as drawn on the camera's frame (pixel corners at the camera's frame size). */
export interface GateDef {
  id: string;
  name: string;
  points: number[][];
}

/** "Leaving through `fromGate`, the vehicle reaches camera `toCameraId`'s gate `toGate` after minS..maxS seconds." */
export interface LinkDef {
  fromGate: string;
  toCameraId: string;
  toGate: string;
  minS: number;
  maxS: number;
  distanceM?: number;
}

/** What the matching needs to know about one sighting (a vehicle from entering to leaving one camera's view). */
export interface SightingFeatures {
  cameraId: string;
  firstSeen: Date;
  lastSeen: Date;
  vehicleClass: string;
  /** bottom-centre of its first / last box, as a fraction of the frame (0..1) */
  entry?: Pt;
  exit?: Pt;
  plateStatus?: string;
  regKey?: string;
  numberKey?: string;
  /** L2-normalised appearance vector (DINOv2) */
  embedding?: Float32Array;
  /** L1-normalised HSV colour histogram */
  colour?: Float32Array;
  slot?: string;
}

export interface MatchSettings {
  /** combined score a candidate needs */
  accept: number;
  /** how far the best candidate must be ahead of the second */
  margin: number;
  /** same camera: a track that ends at most this long before another starts can be its continuation (ID switch) */
  sameCameraGapS: number;
  /** same camera: how close (fraction of the frame) the next track must start to where the previous one ended */
  sameCameraDist: number;
  /** score a renumbered track needs to keep the ID (higher than `accept`: in queues a lookalike neighbour is close) */
  sameCameraAccept: number;
  /** score a match over two links needs (a camera in between missed the vehicle: wider window, more lookalikes) */
  skipAccept: number;
  /** two links: the most time a vehicle spends inside the view of the camera that missed it (queue, signal) */
  skipDwellS: number;
}

/**
 * accept 0.72: DINOv2 + colour on the TEST clip, same vehicle (views 3 s apart) vs other vehicles of its class:
 * 71% / 17.5% above it; with the travel-time window around it, 94% of the cross-camera matches on the simulated
 * second camera were right. sameCameraAccept 0.80: of 16 renumbered tracks checked by eye, the two clear mistakes
 * (a neighbour in a queue) scored 0.74 and 0.76. skipAccept 0.76: the same replay with the two-link window
 * (30-210 s instead of 30-150 s, 295 instead of 231 candidates) kept 95% precision from 0.76 up.
 */
export const DEFAULT_MATCH: MatchSettings = {
  accept: 0.72,
  margin: 0.04,
  sameCameraGapS: 6,
  sameCameraDist: 0.08,
  sameCameraAccept: 0.8,
  skipAccept: 0.76,
  skipDwellS: 60,
};

/** Weights of the appearance score: DINOv2 is trained to ignore colour, so a colour histogram is added. */
const W_EMBED = 0.7;
const W_COLOUR = 0.3;

// ------------------------------------------------------------------------------------------ road graph

/** A camera's links (its outgoing edges in the road graph). */
export interface CameraLinks {
  id: string;
  links: LinkDef[];
}

/**
 * A way from one camera's exit gate to another camera's entry gate: one link, or two links through a camera that
 * missed the vehicle (`via`: it was hidden behind a bus, the detector lost it, the camera was down).
 */
export interface Route {
  fromCameraId: string;
  fromGate: string;
  toCameraId: string;
  toGate: string;
  minS: number;
  maxS: number;
  hops: 1 | 2;
  viaCameraId?: string;
}

/**
 * Every route of one or two links. Two links X -> Y -> Z take [min1 + min2, max1 + max2 + dwellS] (time inside Y's
 * view); none back to the camera it started from, none where a direct link already exists. Built once per change of
 * the network, O(E * k) for k links per camera, then read per sighting: the 1-hop routes first, the 2-hop ones only
 * when no 1-hop candidate is accepted (k^2 lookups at most, still independent of the number of cameras).
 */
export function routesOf(cameras: CameraLinks[], dwellS: number): Route[] {
  const linksOf = new Map(cameras.map((c) => [c.id, c.links]));
  const key = (r: Pick<Route, 'fromCameraId' | 'fromGate' | 'toCameraId' | 'toGate'>) =>
    `${r.fromCameraId}|${r.fromGate}|${r.toCameraId}|${r.toGate}`;
  const direct = new Map<string, Route>();
  for (const c of cameras) {
    for (const l of c.links) {
      if (!l.toCameraId || l.toCameraId === c.id) continue;
      const r: Route = { fromCameraId: c.id, fromGate: l.fromGate, toCameraId: l.toCameraId, toGate: l.toGate, minS: l.minS, maxS: l.maxS, hops: 1 };
      direct.set(key(r), r);
    }
  }
  const twice = new Map<string, Route>();
  for (const a of direct.values()) {
    // which of the middle camera's exits the vehicle took is unknown (no turn table): any of them
    for (const l of linksOf.get(a.toCameraId) ?? []) {
      if (!l.toCameraId || l.toCameraId === a.fromCameraId || l.toCameraId === a.toCameraId) continue;
      const r: Route = {
        fromCameraId: a.fromCameraId,
        fromGate: a.fromGate,
        toCameraId: l.toCameraId,
        toGate: l.toGate,
        minS: a.minS + l.minS,
        maxS: a.maxS + l.maxS + dwellS,
        hops: 2,
        viaCameraId: a.toCameraId,
      };
      const k = key(r);
      if (direct.has(k)) continue;
      const had = twice.get(k);
      if (!had) twice.set(k, r);
      else {
        had.minS = Math.min(had.minS, r.minS);
        had.maxS = Math.max(had.maxS, r.maxS);
      }
    }
  }
  return [...direct.values(), ...twice.values()];
}

// ------------------------------------------------------------------------------------------ IDs

const VID_PREFIX = 'DV-';

/** 123 -> "DV-000123" (more digits once past a million). */
export function formatVid(seq: number): string {
  return `${VID_PREFIX}${String(seq).padStart(6, '0')}`;
}

/** "dv-123", "DV000123", "123" -> "DV-000123"; null when the text is not a Vehicle ID. */
export function parseVid(text: string): string | null {
  const m = text.trim().toUpperCase().match(/^(?:DV)?[\s-]*0*(\d{1,12})$/);
  return m ? formatVid(Number(m[1])) : null;
}

// ------------------------------------------------------------------------------------------ geometry

function inside(p: Pt, poly: number[][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function segmentDistance(p: Pt, a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * The gate a point (fraction of the frame) lies in; when it lies in none, the nearest one within 4% of the frame's
 * diagonal (a vehicle is first or last seen just outside the area drawn), else ''.
 */
export function gateAt(pt: Pt | undefined, gates: GateDef[] | undefined, frameSize: number[] | undefined): string {
  if (!pt || !gates?.length || !frameSize || frameSize.length < 2) return '';
  const [W, H] = frameSize;
  const p: Pt = [pt[0] * W, pt[1] * H];
  let best = '';
  let bestD = 0.04 * Math.hypot(W, H);
  for (const g of gates) {
    if (!Array.isArray(g.points) || g.points.length < 3) continue;
    if (inside(p, g.points)) return g.id;
    for (let i = 0; i < g.points.length; i++) {
      const d = segmentDistance(p, g.points[i], g.points[(i + 1) % g.points.length]);
      if (d < bestD) {
        bestD = d;
        best = g.id;
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------ vectors

/** float32 little-endian bytes (base64 text from the vision service, a Buffer, or a BSON Binary from .lean()). */
export function toFloats(v: unknown): Float32Array | undefined {
  if (v instanceof Float32Array) return v.length ? v : undefined;
  let bytes: Uint8Array | undefined;
  if (typeof v === 'string' && v) bytes = Buffer.from(v, 'base64');
  else if (v instanceof Uint8Array) bytes = v; // Buffer included
  else if (v && typeof v === 'object' && 'buffer' in v && (v as { buffer: unknown }).buffer instanceof Uint8Array) {
    bytes = (v as { buffer: Uint8Array }).buffer;
  }
  if (!bytes || bytes.length < 4 || bytes.length % 4) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function toBuffer(v: Float32Array): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => buf.writeFloatLE(x, i * 4));
  return buf;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Histogram intersection of two L1-normalised histograms: 1 = same colours. */
export function histogramOverlap(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

/** Appearance similarity in about -1..1 (both vectors needed; the colour part only when both have it). */
export function appearanceScore(a: SightingFeatures, b: SightingFeatures): number | null {
  if (!a.embedding || !b.embedding) return null;
  const emb = cosine(a.embedding, b.embedding);
  if (!a.colour || !b.colour) return emb;
  return W_EMBED * emb + W_COLOUR * histogramOverlap(a.colour, b.colour);
}

/** Running mean of a vehicle's vectors (`n` = how many went into `mean`), L2- or L1-normalised again. */
export function updateMean(mean: Float32Array | undefined, n: number, x: Float32Array, norm: 'l2' | 'l1'): Float32Array {
  const out = new Float32Array(x.length);
  const ok = mean && mean.length === x.length && n > 0;
  for (let i = 0; i < x.length; i++) out[i] = ok ? (mean[i] * n + x[i]) / (n + 1) : x[i];
  const total = norm === 'l2' ? Math.sqrt(out.reduce((s, v) => s + v * v, 0)) : out.reduce((s, v) => s + v, 0);
  if (total > 0) for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Two vehicles' means joined (each weighted by how many vectors went into it), normalised again. */
export function mergeMeans(
  a: Float32Array | undefined,
  na: number,
  b: Float32Array | undefined,
  nb: number,
  norm: 'l2' | 'l1',
): Float32Array | undefined {
  if (!a || !na) return b;
  if (!b || !nb || a.length !== b.length) return a;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] * na + b[i] * nb) / (na + nb);
  const total = norm === 'l2' ? Math.sqrt(out.reduce((s, v) => s + v * v, 0)) : out.reduce((s, v) => s + v, 0);
  if (total > 0) for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// ------------------------------------------------------------------------------------------ class, plate

/** Classes the detector confuses with each other (a microbus seen from the front is often called a car). */
const CLASS_GROUPS = [
  ['Car', 'MPV', 'Pickup'],
  ['Bus', 'Truck', 'Bhotbhoti', 'PowerTiller'],
  ['CNG', 'Easybike', 'Leguna'],
  ['Rickshaw', 'Van', 'Bicycle', 'Wheelbarrow'],
  ['Motorbike', 'Bicycle'],
];

/** 0 for the same class, a penalty for a class it is often mistaken for, null when it cannot be the same vehicle. */
export function classPenalty(a: string, b: string): number | null {
  if (!a || !b || a === b) return 0;
  return CLASS_GROUPS.some((g) => g.includes(a) && g.includes(b)) ? -0.06 : null;
}

const PLATE_RANK: Record<string, number> = { 'set by officer': 5, confirmed: 4, uncertain: 2, partial: 1 };

/** How much a plate read can be trusted (officer > confirmed > uncertain > partial > none). */
export function plateRank(status?: string): number {
  return PLATE_RANK[status ?? ''] ?? 0;
}

/**
 * Plate evidence between two sightings: two trusted reads that differ rule the match out (null); equal 6 digits
 * add 0.2, 5 of 6 digits in place 0.08 (uncertain reads often miss one digit); anything else adds nothing.
 */
export function plateBonus(a: SightingFeatures, b: SightingFeatures): number | null {
  const trusted = (s: SightingFeatures) => plateRank(s.plateStatus) >= 4 && !!s.regKey;
  if (trusted(a) && trusted(b)) return a.regKey === b.regKey ? 0.4 : null;
  if (a.numberKey && b.numberKey && a.numberKey.length === 6 && b.numberKey.length === 6) {
    if (a.numberKey === b.numberKey) return 0.2;
    let same = 0;
    for (let i = 0; i < 6; i++) if (a.numberKey[i] === b.numberKey[i]) same++;
    return same >= 5 ? 0.08 : 0;
  }
  return 0;
}

// ------------------------------------------------------------------------------------------ scoring

export interface Scored<T> {
  candidate: T;
  score: number;
  appearance: number | null;
}

/**
 * Score of `cand` (a sighting at an upstream camera, already carrying a Vehicle ID) being the same vehicle as `s`.
 * null when it cannot be (class, plate). The link's timing is a gate, not a score: candidates come from inside the
 * window. Without appearance vectors only a plate can carry a match.
 */
export function scoreLinkCandidate(s: SightingFeatures, cand: SightingFeatures): number | null {
  const cls = classPenalty(s.vehicleClass, cand.vehicleClass);
  const plate = plateBonus(s, cand);
  if (cls === null || plate === null) return null;
  const app = appearanceScore(s, cand);
  return (app ?? 0) + cls + plate;
}

/**
 * Same camera: is `prev` (another track at this camera) the same vehicle as `s`? Either a duplicate (another run,
 * e.g. the speed box and the violations box both listed it: same time, same path) or, in the same run, a
 * continuation (the tracker lost it and gave it a new number: `prev` ends shortly before `s` starts, where `s`
 * starts). Two tracks of one run at the same time are two vehicles. Returns a score or null.
 */
export function scoreSameCamera(
  s: SightingFeatures,
  prev: SightingFeatures,
  sameRun: boolean,
  cfg: MatchSettings = DEFAULT_MATCH,
): number | null {
  if (!s.entry || !s.exit || !prev.entry || !prev.exit) return null;
  const cls = classPenalty(s.vehicleClass, prev.vehicleClass);
  const plate = plateBonus(s, prev);
  if (cls === null || plate === null) return null;
  const app = appearanceScore(s, prev);
  const t = (d: Date) => d.getTime() / 1000;
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  if (!sameRun) {
    const duplicate =
      Math.abs(t(s.firstSeen) - t(prev.firstSeen)) <= 2.5 &&
      Math.abs(t(s.lastSeen) - t(prev.lastSeen)) <= 2.5 &&
      dist(s.entry, prev.entry) <= 0.06 &&
      dist(s.exit, prev.exit) <= 0.06;
    return duplicate ? 1 + (app ?? 0) * 0.1 + cls : null;
  }

  // The tracker lost the vehicle and numbered it anew: the old track ended (gap >= 0.5 s: two tracks that overlap
  // in time are two vehicles) shortly before the new one started, where it started, and it looks the same. On the
  // TEST clip the first rule (place + time, appearance only as a veto) joined a third of all tracks, 6 of 16 checked
  // were neighbours (a CNG next to a car, a bystander next to a rider): in queues and crowds a neighbour is always
  // close by, so the appearance must agree, more strictly than for another camera (sameCameraAccept, in the service).
  const gap = t(s.firstSeen) - t(prev.lastSeen);
  const continuation = gap >= 0.5 && gap <= cfg.sameCameraGapS && dist(prev.exit, s.entry) <= cfg.sameCameraDist;
  if (!continuation || app === null || app < cfg.accept) return null;
  const closeness = 1 - dist(prev.exit, s.entry) / cfg.sameCameraDist;   // 1 = exactly where it was lost
  return app + 0.1 * closeness + cls + plate;
}

/**
 * The best candidate if it scores at least `accept` and the second best is `margin` behind; else null.
 * (A learned travel-time penalty per link, the paper's camera-link model, was tried on the simulated second camera
 * 2026-10-29: recall 78.6 -> 81-85% but precision 94.2 -> 89-91%; not used. Retry with two real cameras.)
 */
export function pickBest<T>(scored: Scored<T>[], cfg: MatchSettings = DEFAULT_MATCH): Scored<T> | null {
  if (!scored.length) return null;
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const [best, second] = sorted;
  if (best.score < cfg.accept) return null;
  if (second && best.score - second.score < cfg.margin) return null;
  return best;
}

// ------------------------------------------------------------------------------------------ appearance text

const COLOURS = new Set([
  'white', 'black', 'grey', 'silver', 'red', 'maroon', 'blue', 'green', 'yellow', 'orange', 'brown', 'golden', 'beige',
  'purple', 'pink', 'cream',
]);

/** "green CNG" -> {colour: 'green', type: 'cng'}; "white rickshaw van" -> {colour: 'white', type: 'rickshaw van'}
 * (lower case: the search keys). "grey" and "gray" are one colour. */
export function parseAppearance(text?: string): { colour: string; type: string } {
  const words = (text ?? '').trim().toLowerCase().replace(/\bgray\b/g, 'grey').split(/\s+/).filter(Boolean);
  if (!words.length) return { colour: '', type: '' };
  return COLOURS.has(words[0])
    ? { colour: words[0], type: words.slice(1).join(' ') }
    : { colour: '', type: words.join(' ') };
}
