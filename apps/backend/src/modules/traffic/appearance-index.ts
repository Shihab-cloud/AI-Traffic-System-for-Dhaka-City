/**
 * Nearest appearance vectors among all vehicles: an HNSW graph (Malkov & Yashunin, "Efficient and robust approximate
 * nearest neighbor search using Hierarchical Navigable Small World graphs", 2018). Insert O(log n), query O(log n)
 * vector comparisons instead of the O(n) of comparing with every vehicle. Pure TypeScript, in memory (no native
 * module to build); vectors are L2-normalised, so similarity = dot product (cosine).
 *
 * Used for the officers' "look-alikes" search across the whole network, never to give Vehicle IDs by itself: without
 * a camera link's place and time, lookalikes are too many (17.5% of other vehicles of a class pass the match score on
 * the TEST clip).
 */

interface Node {
  key: string;
  vec: Float32Array;
  /** neighbours per layer (node numbers) */
  links: number[][];
  deleted: boolean;
}

interface Hit {
  id: number;
  d: number;
}

/** Binary heap of hits, nearest first (`max` false) or farthest first (`max` true). */
class Heap {
  private a: Hit[] = [];
  constructor(private readonly max: boolean) {}
  get size() {
    return this.a.length;
  }
  peek(): Hit {
    return this.a[0];
  }
  private before(x: Hit, y: Hit) {
    return this.max ? x.d > y.d : x.d < y.d;
  }
  push(h: Hit) {
    const a = this.a;
    a.push(h);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): Hit | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.before(a[l], a[m])) m = l;
        if (r < a.length && this.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  items(): Hit[] {
    return this.a;
  }
}

function normalised(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export interface IndexOptions {
  /** links per node and layer (layer 0 has twice as many) */
  M?: number;
  /** candidates kept while inserting (bigger: better graph, slower inserts) */
  efConstruction?: number;
  /** a vehicle's vector that moved less than this (cosine) keeps its place in the graph */
  keepAbove?: number;
  seed?: number;
}

export class AppearanceIndex {
  private readonly M: number;
  private readonly M0: number;
  private readonly efC: number;
  private readonly keepAbove: number;
  private readonly mL: number;
  private nodes: Node[] = [];
  private byKey = new Map<string, number>();
  private entry = -1;
  private top = -1;
  private seen = new Uint32Array(0);
  private stamp = 0;
  private rand: () => number;
  readonly dim: number;

  constructor(dim: number, opts: IndexOptions = {}) {
    this.dim = dim;
    this.M = opts.M ?? 16;
    this.M0 = 2 * this.M;
    this.efC = opts.efConstruction ?? 100;
    this.keepAbove = opts.keepAbove ?? 0.98;
    this.mL = 1 / Math.log(this.M);
    let seed = opts.seed ?? 12345;
    this.rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** vehicles in the index */
  get size(): number {
    return this.byKey.size;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  clear() {
    this.nodes = [];
    this.byKey.clear();
    this.entry = -1;
    this.top = -1;
  }

  /**
   * Adds a vehicle or moves it. A running mean drifts little from sighting to sighting: then the vector is replaced
   * in place and its links kept; a big change (two vehicles joined) inserts it anew and the old node only routes.
   */
  upsert(key: string, vec: Float32Array) {
    if (vec.length !== this.dim) return;
    const v = normalised(vec);
    const id = this.byKey.get(key);
    if (id !== undefined) {
      const n = this.nodes[id];
      if (1 - this.dist(n.vec, v) >= this.keepAbove) {
        n.vec = v;
        return;
      }
      n.deleted = true;
      this.byKey.delete(key);
    }
    this.insert(key, v);
  }

  /** The vehicle no longer exists (joined to another): its node stays in the graph for routing only. */
  remove(key: string) {
    const id = this.byKey.get(key);
    if (id === undefined) return;
    this.nodes[id].deleted = true;
    this.byKey.delete(key);
  }

  /** The k vehicles with the most similar vectors (cosine, 1 = identical), most similar first. */
  search(query: Float32Array, k: number, ef = Math.max(k, 64)): { key: string; similarity: number }[] {
    if (this.entry < 0 || query.length !== this.dim) return [];
    const q = normalised(query);
    let ep = this.entry;
    for (let l = this.top; l > 0; l--) ep = this.greedy(q, ep, l);
    return this.layer(q, ep, Math.max(ef, k), 0)
      .filter((h) => !this.nodes[h.id].deleted)
      .slice(0, k)
      .map((h) => ({ key: this.nodes[h.id].key, similarity: 1 - h.d }));
  }

  // ------------------------------------------------------------------------------------------ graph

  private dist(a: Float32Array, b: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return 1 - s;
  }

  private insert(key: string, v: Float32Array) {
    const id = this.nodes.length;
    const level = Math.floor(-Math.log(1 - this.rand()) * this.mL);
    const node: Node = { key, vec: v, links: Array.from({ length: level + 1 }, () => []), deleted: false };
    this.nodes.push(node);
    this.byKey.set(key, id);
    if (this.entry < 0) {
      this.entry = id;
      this.top = level;
      return;
    }
    let ep = this.entry;
    for (let l = this.top; l > level; l--) ep = this.greedy(v, ep, l);
    for (let l = Math.min(level, this.top); l >= 0; l--) {
      const found = this.layer(v, ep, this.efC, l);
      const max = l === 0 ? this.M0 : this.M;
      node.links[l] = this.select(found, this.M).map((h) => h.id);
      for (const nb of node.links[l]) {
        const links = this.nodes[nb].links[l];
        links.push(id);
        if (links.length > max) {
          const nv = this.nodes[nb].vec;
          const cands = links.map((x) => ({ id: x, d: this.dist(nv, this.nodes[x].vec) })).sort((a, b) => a.d - b.d);
          this.nodes[nb].links[l] = this.select(cands, max).map((h) => h.id);
        }
      }
      ep = found[0].id;
    }
    if (level > this.top) {
      this.top = level;
      this.entry = id;
    }
  }

  /** Walks to the nearest node on one layer (the upper layers: one candidate). */
  private greedy(q: Float32Array, ep: number, l: number): number {
    let cur = ep;
    let d = this.dist(q, this.nodes[cur].vec);
    for (let moved = true; moved; ) {
      moved = false;
      for (const nb of this.nodes[cur].links[l] ?? []) {
        const dn = this.dist(q, this.nodes[nb].vec);
        if (dn < d) {
          d = dn;
          cur = nb;
          moved = true;
        }
      }
    }
    return cur;
  }

  /** Best-first search on one layer keeping `ef` results; nearest first. */
  private layer(q: Float32Array, ep: number, ef: number, l: number): Hit[] {
    if (this.seen.length < this.nodes.length) {
      const grown = new Uint32Array(Math.max(1024, this.nodes.length * 2));
      grown.set(this.seen);
      this.seen = grown;
    }
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const start = { id: ep, d: this.dist(q, this.nodes[ep].vec) };
    this.seen[ep] = this.stamp;
    const todo = new Heap(false);
    const best = new Heap(true);
    todo.push(start);
    best.push(start);
    while (todo.size) {
      const c = todo.pop()!;
      if (c.d > best.peek().d && best.size >= ef) break;
      for (const nb of this.nodes[c.id].links[l] ?? []) {
        if (this.seen[nb] === this.stamp) continue;
        this.seen[nb] = this.stamp;
        const d = this.dist(q, this.nodes[nb].vec);
        if (best.size < ef || d < best.peek().d) {
          todo.push({ id: nb, d });
          best.push({ id: nb, d });
          if (best.size > ef) best.pop();
        }
      }
    }
    return [...best.items()].sort((a, b) => a.d - b.d);
  }

  /**
   * Neighbour choice (the paper's heuristic): a candidate is kept when it is nearer to the new node than to any
   * neighbour kept so far, so links point in different directions; the nearest of the rest fill the remaining places.
   */
  private select(sorted: Hit[], m: number): Hit[] {
    const out: Hit[] = [];
    const skipped: Hit[] = [];
    for (const c of sorted) {
      if (out.length >= m) break;
      const cv = this.nodes[c.id].vec;
      if (out.every((o) => this.dist(cv, this.nodes[o.id].vec) > c.d)) out.push(c);
      else skipped.push(c);
    }
    for (const c of skipped) {
      if (out.length >= m) break;
      out.push(c);
    }
    return out;
  }
}
