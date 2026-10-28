import { ObjectId } from 'mongodb';

/**
 * Minimal in-memory stand-in for a native MongoDB collection that preserves
 * the one semantic these tests exist to pin down: BSON type-sensitive
 * equality. An ObjectId stored on a document NEVER matches a string in a
 * query filter (and vice versa) — exactly like real MongoDB.
 */
export class FakeCollection {
  docs: Record<string, unknown>[] = [];

  /**
   * Field sets that must be unique, mirroring a real unique index.
   *
   * Without this a test cannot tell a guard that reads-then-writes from one
   * that relies on the index, because the fake happily accepts both inserts.
   */
  constructor(private readonly uniqueOn: string[][] = []) {}

  private violatesUnique(doc: Record<string, unknown>): boolean {
    return this.uniqueOn.some((keys) => {
      if (keys.some((key) => doc[key] === undefined)) return false;
      const filter = Object.fromEntries(keys.map((key) => [key, doc[key]]));
      return this.docs.some((existing) => this.matches(existing, filter));
    });
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
    // ObjectId vs string (either direction) is a type mismatch in BSON — no match.
    if (a instanceof ObjectId || b instanceof ObjectId) return false;
    return a === b;
  }

  private matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, expected]) => this.valuesEqual(doc[key], expected));
  }

  async findOne(filter: Record<string, unknown>, _opts?: unknown) {
    return this.docs.find((d) => this.matches(d, filter)) ?? null;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: { $set: Record<string, unknown> },
    _opts?: unknown,
  ) {
    const doc = this.docs.find((d) => this.matches(d, filter));
    if (doc) Object.assign(doc, update.$set);
    return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
  }

  async insertOne(doc: Record<string, unknown>, _opts?: unknown) {
    if (this.violatesUnique(doc)) {
      // Shape matters: callers branch on `code === 11000`.
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    }
    const withId = { _id: new ObjectId(), ...doc };
    this.docs.push(withId);
    return { insertedId: withId._id, acknowledged: true };
  }
}

/**
 * Fake Mongoose `Connection` exposing only what the services under test use:
 * `connection.db.collection(name)` and `startSession().withTransaction(fn)`.
 * Transactions are executed inline (no real session semantics needed here).
 */
export function fakeConnection(collections: Record<string, FakeCollection>) {
  return {
    db: {
      collection: (name: string) => {
        const col = collections[name];
        if (!col) throw new Error(`FakeCollection not registered: ${name}`);
        return col;
      },
    },
    startSession: async () => ({
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: async () => {},
    }),
  };
}

/** Chainable `.select().lean()` query mock resolving to `result`. */
export function leanQuery<T>(result: T) {
  return {
    select: () => ({ lean: async () => result }),
  };
}
