import { AppearanceIndex } from './appearance-index';

let seed = 99;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

function unit(v: number[]): Float32Array {
  const n = Math.hypot(...v);
  return Float32Array.from(v, (x) => x / n);
}

/** vehicles of a few "models" (clusters), each seen a bit differently */
function vehicles(n: number, dim: number, models = 40): Float32Array[] {
  const centres = Array.from({ length: models }, () => Array.from({ length: dim }, gauss));
  return Array.from({ length: n }, () => {
    const c = centres[Math.floor(rnd() * models)];
    return unit(c.map((x) => x + 0.6 * gauss()));
  });
}

function bruteForce(all: Float32Array[], q: Float32Array, k: number): number[] {
  return all
    .map((v, i) => ({ i, s: v.reduce((acc, x, j) => acc + x * q[j], 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.i);
}

describe('appearance index (HNSW)', () => {
  it('finds the same nearest vehicles as comparing with every one (recall@10 >= 95%)', () => {
    const dim = 32;
    const all = vehicles(3000, dim);
    const index = new AppearanceIndex(dim, { seed: 1 });
    all.forEach((v, i) => index.upsert(`v${i}`, v));
    expect(index.size).toBe(3000);
    let hit = 0;
    const queries = 50;
    for (let q = 0; q < queries; q++) {
      const query = vehicles(1, dim)[0];
      const truth = new Set(bruteForce(all, query, 10).map((i) => `v${i}`));
      for (const h of index.search(query, 10, 100)) if (truth.has(h.key)) hit++;
    }
    expect(hit / (queries * 10)).toBeGreaterThanOrEqual(0.95);
  });

  it('a vehicle finds itself; moved and removed vehicles are handled', () => {
    const dim = 16;
    const all = vehicles(500, dim);
    const index = new AppearanceIndex(dim, { seed: 2 });
    all.forEach((v, i) => index.upsert(`v${i}`, v));
    expect(index.search(all[42], 1)[0]).toMatchObject({ key: 'v42' });
    expect(index.search(all[42], 1)[0].similarity).toBeCloseTo(1, 5);

    // a big move (two vehicles joined): found at its new place, once
    index.upsert('v42', all[7]);
    const near7 = index.search(all[7], 3).map((h) => h.key);
    expect(near7).toEqual(expect.arrayContaining(['v7', 'v42']));
    expect(index.search(all[7], 50).filter((h) => h.key === 'v42')).toHaveLength(1);

    index.remove('v7');
    expect(index.search(all[7], 50).some((h) => h.key === 'v7')).toBe(false);
    expect(index.size).toBe(499);
    expect(index.search(Float32Array.from([1, 2]), 5)).toEqual([]); // wrong size: nothing, no crash
  });
});
