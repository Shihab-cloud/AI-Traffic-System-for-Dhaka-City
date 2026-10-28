import { searchMode } from './vehicle-search.service';
import {
  classPenalty,
  DEFAULT_MATCH,
  formatVid,
  gateAt,
  mergeMeans,
  parseAppearance,
  parseVid,
  pickBest,
  plateBonus,
  routesOf,
  scoreLinkCandidate,
  scoreSameCamera,
  type SightingFeatures,
  toBuffer,
  toFloats,
  updateMean,
} from './vehicle-matching';

const T0 = Date.UTC(2026, 8, 22, 11, 46, 5);
const at = (s: number) => new Date(T0 + s * 1000);

function unit(values: number[]): Float32Array {
  const v = Float32Array.from(values);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

function sighting(over: Partial<SightingFeatures> = {}): SightingFeatures {
  return {
    cameraId: 'cam-a',
    firstSeen: at(0),
    lastSeen: at(8),
    vehicleClass: 'Car',
    entry: [0.3, 0.95],
    exit: [0.45, 0.2],
    embedding: unit([1, 0.2, 0, 0]),
    colour: Float32Array.from([0.5, 0.5, 0, 0]),
    ...over,
  };
}

describe('Vehicle IDs', () => {
  it('formats and parses', () => {
    expect(formatVid(123)).toBe('DV-000123');
    expect(formatVid(12_345_678)).toBe('DV-12345678');
    expect(parseVid('dv-123')).toBe('DV-000123');
    expect(parseVid('DV000123')).toBe('DV-000123');
    expect(parseVid(' 42 ')).toBe('DV-000042');
    expect(parseVid('11-5431')).toBeNull();
    expect(parseVid('Dhaka Metro-Ga 11-5431')).toBeNull();
  });

  it('tells IDs, plates and looks apart', () => {
    expect(searchMode('DV-000123')).toBe('id');
    expect(searchMode('123')).toBe('id');
    expect(searchMode('115431')).toBe('plate');
    expect(searchMode('11-5431')).toBe('plate');
    expect(searchMode('Dhaka Metro-Ga 11-5431')).toBe('plate');
    expect(searchMode('white SUV')).toBe('appearance');
    expect(searchMode('')).toBe('appearance');
  });
});

describe('gates', () => {
  const gates = [
    { id: 'far', name: 'Far end', points: [[0, 0], [1000, 0], [1000, 300], [0, 300]] },
    { id: 'near', name: 'Near end', points: [[0, 900], [1000, 900], [1000, 1000], [0, 1000]] },
  ];
  it('finds the gate a point lies in, or the nearest one close by', () => {
    expect(gateAt([0.5, 0.1], gates, [1000, 1000])).toBe('far');
    expect(gateAt([0.5, 0.95], gates, [1000, 1000])).toBe('near');
    expect(gateAt([0.5, 0.33], gates, [1000, 1000])).toBe('far'); // 30 px outside: within 4% of the diagonal
    expect(gateAt([0.5, 0.6], gates, [1000, 1000])).toBe(''); // the middle of the picture
    expect(gateAt([0.5, 0.1], [], [1000, 1000])).toBe('');
    expect(gateAt(undefined, gates, [1000, 1000])).toBe('');
  });
});

describe('vectors', () => {
  it('round-trips float32 bytes, base64 and BSON-like binaries', () => {
    const v = Float32Array.from([0.25, -1.5, 3]);
    const buf = toBuffer(v);
    expect(Array.from(toFloats(buf)!)).toEqual([0.25, -1.5, 3]);
    expect(Array.from(toFloats(buf.toString('base64'))!)).toEqual([0.25, -1.5, 3]);
    expect(Array.from(toFloats({ buffer: new Uint8Array(buf) })!)).toEqual([0.25, -1.5, 3]);
    expect(toFloats('')).toBeUndefined();
    expect(toFloats(Buffer.from([1, 2, 3]))).toBeUndefined();
  });

  it('keeps a running mean normalised', () => {
    const a = unit([1, 0]);
    const b = unit([0, 1]);
    const m = updateMean(a, 1, b, 'l2');
    expect(Math.hypot(...m)).toBeCloseTo(1, 5);
    expect(m[0]).toBeCloseTo(m[1], 5);
    const h = updateMean(Float32Array.from([1, 0]), 1, Float32Array.from([0, 1]), 'l1');
    expect(h[0] + h[1]).toBeCloseTo(1, 5);
  });

  it('joins two vehicles means by their counts', () => {
    const m = mergeMeans(unit([1, 0]), 3, unit([0, 1]), 1, 'l2')!;
    expect(Math.hypot(...m)).toBeCloseTo(1, 5);
    expect(m[0] / m[1]).toBeCloseTo(3, 5);
    expect(mergeMeans(undefined, 0, unit([0, 1]), 2, 'l2')).toEqual(unit([0, 1]));
    expect(mergeMeans(unit([1, 0]), 2, undefined, 0, 'l2')).toEqual(unit([1, 0]));
  });
});

describe('road graph', () => {
  // Kakoli -> Shewra -> Kuril northbound, Kuril -> Shewra southbound
  const link = (fromGate: string, toCameraId: string, toGate: string, minS: number, maxS: number) => ({ fromGate, toCameraId, toGate, minS, maxS });
  const cams = [
    { id: 'kakoli', links: [link('N-out', 'shewra', 'S-in', 60, 180)] },
    { id: 'shewra', links: [link('N-out', 'kuril', 'S-in', 90, 240), link('S-out', 'kakoli', 'N-in', 60, 180)] },
    { id: 'kuril', links: [link('S-out', 'shewra', 'N-in', 90, 240)] },
  ];

  it('adds two-link routes through a camera that may miss the vehicle', () => {
    const routes = routesOf(cams, 60);
    expect(routes.filter((r) => r.hops === 1)).toHaveLength(4);
    const skip = routes.find((r) => r.hops === 2 && r.fromCameraId === 'kakoli' && r.toCameraId === 'kuril')!;
    expect(skip).toMatchObject({ fromGate: 'N-out', toGate: 'S-in', minS: 150, maxS: 480, viaCameraId: 'shewra' });
    // never back to where it started (Kakoli -> Shewra -> Kakoli is a U-turn the same-camera rule handles)
    expect(routes.some((r) => r.hops === 2 && r.fromCameraId === r.toCameraId)).toBe(false);
    expect(routes.find((r) => r.hops === 2 && r.fromCameraId === 'kuril')).toMatchObject({ toCameraId: 'kakoli', minS: 150, maxS: 480 });
  });

  it('a direct link wins over a two-link route between the same gates', () => {
    const withDirect = [...cams.slice(0, 2), { id: 'kuril', links: [] }];
    withDirect[0] = { id: 'kakoli', links: [...cams[0].links, link('N-out', 'kuril', 'S-in', 100, 300)] };
    const routes = routesOf(withDirect, 60).filter((r) => r.fromCameraId === 'kakoli' && r.toCameraId === 'kuril');
    expect(routes).toHaveLength(1);
    expect(routes[0].hops).toBe(1);
  });
});

describe('class and plate evidence', () => {
  it('allows classes the detector confuses, rules out the rest', () => {
    expect(classPenalty('Car', 'Car')).toBe(0);
    expect(classPenalty('Car', 'MPV')).toBeLessThan(0);
    expect(classPenalty('Car', 'Bus')).toBeNull();
    expect(classPenalty('', 'Bus')).toBe(0);
  });

  it('two trusted plates must agree; digits help', () => {
    const conf = (regKey: string): SightingFeatures => sighting({ plateStatus: 'confirmed', regKey });
    expect(plateBonus(conf('DHAKAMETROGA115431'), conf('DHAKAMETROGA115431'))).toBe(0.4);
    expect(plateBonus(conf('DHAKAMETROGA115431'), conf('DHAKAMETROGA119999'))).toBeNull();
    expect(plateBonus(sighting({ numberKey: '115431' }), sighting({ numberKey: '115431' }))).toBe(0.2);
    expect(plateBonus(sighting({ numberKey: '115431' }), sighting({ numberKey: '115731' }))).toBe(0.08);
    expect(plateBonus(sighting({ numberKey: '115431' }), sighting({ numberKey: '229999' }))).toBe(0);
  });
});

describe('matching across cameras', () => {
  const s = sighting({ cameraId: 'cam-b', firstSeen: at(90), lastSeen: at(98) });

  it('the same vehicle scores above ACCEPT, another one below', () => {
    const same = sighting({ embedding: unit([1, 0.22, 0.02, 0]), colour: Float32Array.from([0.48, 0.52, 0, 0]) });
    const other = sighting({ embedding: unit([0.2, 1, 0.3, 0]), colour: Float32Array.from([0, 0, 0.5, 0.5]) });
    expect(scoreLinkCandidate(s, same)!).toBeGreaterThan(DEFAULT_MATCH.accept);
    expect(scoreLinkCandidate(s, other)!).toBeLessThan(DEFAULT_MATCH.accept);
    expect(scoreLinkCandidate(s, sighting({ vehicleClass: 'Bus' }))).toBeNull();
  });

  it('keeps an ID only when the best candidate clearly leads', () => {
    const c = (score: number) => ({ candidate: score, score, appearance: null });
    expect(pickBest([c(0.9), c(0.5)])?.score).toBe(0.9);
    expect(pickBest([c(0.9), c(0.88)])).toBeNull(); // two lookalikes: a new ID is safer than a wrong one
    expect(pickBest([c(0.6)])).toBeNull();
    expect(pickBest([])).toBeNull();
  });
});

describe('same camera', () => {
  it('a duplicate from another box (same time, same path) is the same vehicle', () => {
    const a = sighting();
    const b = sighting({ firstSeen: at(0.4), lastSeen: at(8.6), entry: [0.31, 0.94], exit: [0.46, 0.21] });
    expect(scoreSameCamera(b, a, false)!).toBeGreaterThan(0.9);
    // two tracks of the same run at the same time are two vehicles, however close
    expect(scoreSameCamera(b, a, true)).toBeNull();
  });

  it('the tracker losing a vehicle and renumbering it is a continuation', () => {
    const before = sighting({ firstSeen: at(0), lastSeen: at(5), exit: [0.4, 0.5] });
    const after = sighting({ firstSeen: at(7), lastSeen: at(12), entry: [0.42, 0.48] });
    expect(scoreSameCamera(after, before, true)!).toBeGreaterThan(DEFAULT_MATCH.accept);
    // overlapping in time: two vehicles side by side, not one renumbered
    const overlapping = sighting({ firstSeen: at(4.8), lastSeen: at(12), entry: [0.42, 0.48] });
    expect(scoreSameCamera(overlapping, before, true)).toBeNull();
    // no appearance vectors: place and time alone are not enough
    expect(scoreSameCamera({ ...after, embedding: undefined }, before, true)).toBeNull();
    const farAway = sighting({ firstSeen: at(7), lastSeen: at(12), entry: [0.9, 0.9] });
    expect(scoreSameCamera(farAway, before, true)).toBeNull();
    const muchLater = sighting({ firstSeen: at(30), lastSeen: at(35), entry: [0.42, 0.48] });
    expect(scoreSameCamera(muchLater, before, true)).toBeNull();
    const lookalikeNot = sighting({ firstSeen: at(7), lastSeen: at(12), entry: [0.42, 0.48], embedding: unit([0, 0, 1, 0]), colour: Float32Array.from([0, 0, 1, 0]) });
    expect(scoreSameCamera(lookalikeNot, before, true)).toBeNull();
  });
});

describe('appearance text', () => {
  it('splits colour and type for search', () => {
    expect(parseAppearance('green CNG')).toEqual({ colour: 'green', type: 'cng' });
    expect(parseAppearance('White rickshaw van')).toEqual({ colour: 'white', type: 'rickshaw van' });
    expect(parseAppearance('gray SUV')).toEqual({ colour: 'grey', type: 'suv' });
    expect(parseAppearance('bus')).toEqual({ colour: '', type: 'bus' });
    expect(parseAppearance('')).toEqual({ colour: '', type: '' });
  });
});
