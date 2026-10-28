/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument */
import type Redis from 'ioredis';
import {
  RATE_LIMIT_CUSTOM_RULES,
  SHARED_BUCKET_MAX_MULTIPLIER,
  createRedisRateLimitStorage,
  parseTrustedProxies,
} from './rate-limit';

/**
 * End-to-end proof against the real Better Auth request pipeline that
 * `advanced.ipAddress.trustedProxies` is what stands between per-client rate
 * limiting and a single instance-wide bucket.
 *
 * Two things force these tests to run against a *production* Better Auth:
 *
 *  - `rateLimit.enabled` defaults to `NODE_ENV === 'production'`.
 *  - `getIp()` short-circuits to `127.0.0.1` under test/development, which
 *    hides the unresolvable-chain case entirely.
 *
 * Better Auth reads `NODE_ENV` once at module load, so the module graph is
 * loaded inside `jest.isolateModules` with the env already set. That is also
 * exactly why this bug is production-only and never reproduced locally.
 */

// Each test boots a real Better Auth instance and drives password hashing
// through its sign-in route, so the default 5s budget is too tight.
jest.setTimeout(60_000);

const REAL_NODE_ENV = process.env.NODE_ENV;

function loadBetterAuthAsProduction() {
  process.env.NODE_ENV = 'production';
  let loaded: any;
  try {
    jest.isolateModules(() => {
      loaded = {
        betterAuth: require('better-auth').betterAuth,
        memoryAdapter: require('better-auth/adapters/memory').memoryAdapter,
      };
    });
  } finally {
    process.env.NODE_ENV = REAL_NODE_ENV;
  }
  return loaded;
}

/** Minimal in-memory Redis double covering the commands our storage issues. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const values = new Map<string, string>();
  const redis = {
    eval: async (_script: string, _numKeys: number, key: string, _ttl: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    },
  };
  return { redis: redis as unknown as Redis, counters };
}

interface Harness {
  request: (path: string, xff: string, init?: RequestInit) => Promise<Response>;
  keys: () => string[];
}

/**
 * Boots a Better Auth instance wired with the production rate-limit config from
 * `rate-limit.ts`. `ipAddress` is passed in so a test can reproduce the
 * pre-fix behaviour by omitting it.
 */
function harness(
  ipAddress?: { trustedProxies: string[] },
  customRules: Record<string, { window: number; max: number }> = RATE_LIMIT_CUSTOM_RULES,
): Harness {
  const { betterAuth, memoryAdapter } = loadBetterAuthAsProduction();
  const { redis, counters } = fakeRedis();

  const auth = betterAuth({
    secret: 'test-secret-that-is-long-enough-for-better-auth',
    basePath: '/api/auth',
    baseURL: 'http://backend.test',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    advanced: ipAddress ? { ipAddress } : {},
    rateLimit: {
      enabled: true,
      customRules,
      customStorage: createRedisRateLimitStorage(redis),
    },
  });

  return {
    request: (path, xff, init) =>
      auth.handler(
        new Request(`http://backend.test/api/auth${path}`, {
          ...init,
          headers: { 'x-forwarded-for': xff, ...(init?.headers as Record<string, string>) },
        }),
      ),
    keys: () => [...counters.keys()],
  };
}

const signIn = (email: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
});

// The chain a browser-originated auth call actually carries in production:
// frontend nginx and backend nginx both append via `$proxy_add_x_forwarded_for`
// and the Next rewrite adds a hop of its own.
const PROD_CHAIN = (clientIp: string) => `${clientIp}, 172.18.0.7, 172.18.0.3`;

const CLIENT_A = '203.0.113.10';
const CLIENT_B = '198.51.100.20';

describe('Better Auth rate limiting — client IP resolution', () => {
  afterEach(() => {
    expect(process.env.NODE_ENV).toBe(REAL_NODE_ENV);
  });

  describe('without advanced.ipAddress (the reported bug)', () => {
    it('collapses every client onto the shared no-trusted-ip bucket', async () => {
      const app = harness();

      await app.request('/get-session', PROD_CHAIN(CLIENT_A));
      await app.request('/get-session', PROD_CHAIN(CLIENT_B));

      expect(app.keys()).toEqual(['no-trusted-ip|/get-session']);
    });

    it('throttles distinct users against each other on /sign-in', async () => {
      // Reproduced against Better Auth's own storage so the 429 is real
      // enforcement, not our fail-open storage. Better Auth's built-in rule for
      // /sign-in is 3 per 10s — instance-wide once the IP is unresolvable.
      const { betterAuth, memoryAdapter } = loadBetterAuthAsProduction();
      const auth = betterAuth({
        secret: 'test-secret-that-is-long-enough-for-better-auth',
        basePath: '/api/auth',
        baseURL: 'http://backend.test',
        database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
        emailAndPassword: { enabled: true },
        rateLimit: { enabled: true, storage: 'memory' },
      });

      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await auth.handler(
          new Request('http://backend.test/api/auth/sign-in/email', {
            ...signIn(`staff${i}@example.com`),
            headers: {
              'content-type': 'application/json',
              'x-forwarded-for': PROD_CHAIN(`203.0.113.${i + 1}`),
            },
          }),
        );
        statuses.push(res.status);
      }

      // Five different people on five different networks; the last two are
      // rejected because of what the first three did.
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    });
  });

  describe('with advanced.ipAddress.trustedProxies (the fix)', () => {
    const trustedProxies = parseTrustedProxies(undefined);

    it('resolves the real client through a multi-hop proxy chain', async () => {
      const app = harness({ trustedProxies });

      await app.request('/get-session', PROD_CHAIN(CLIENT_A));
      await app.request('/get-session', PROD_CHAIN(CLIENT_B));

      expect(app.keys().sort()).toEqual(
        [`${CLIENT_B}|/get-session`, `${CLIENT_A}|/get-session`].sort(),
      );
      expect(app.keys()).not.toContain('no-trusted-ip|/get-session');
    });

    it('still resolves a single-hop chain (direct API calls)', async () => {
      const app = harness({ trustedProxies });
      await app.request('/get-session', CLIENT_A);
      expect(app.keys()).toEqual([`${CLIENT_A}|/get-session`]);
    });

    it('keys /token per client too', async () => {
      const app = harness({ trustedProxies });
      await app.request('/token', PROD_CHAIN(CLIENT_A));
      await app.request('/token', PROD_CHAIN(CLIENT_B));
      expect(app.keys().sort()).toEqual([`${CLIENT_A}|/token`, `${CLIENT_B}|/token`].sort());
    });

    it('does not let one user exhausting /get-session affect another', async () => {
      // Ceiling lowered so the loop is a handful of requests rather than the
      // production 1000. What is under test is the *bucketing*, not the number
      // — the production values are asserted in `rate-limit.spec.ts`.
      const app = harness({ trustedProxies }, { '/get-session': { window: 60, max: 3 } });

      const noisyNeighbour: number[] = [];
      for (let i = 0; i < 5; i++) {
        noisyNeighbour.push((await app.request('/get-session', PROD_CHAIN(CLIENT_A))).status);
      }
      const victim = await app.request('/get-session', PROD_CHAIN(CLIENT_B));

      // The heavy user is throttled...
      expect(noisyNeighbour).toContain(429);
      // ...and nobody else is. This is the whole bug: before the fix, CLIENT_B
      // shared CLIENT_A's counter and got signed out by CLIENT_A's traffic.
      expect(victim.status).not.toBe(429);
    });

    it('reports a usable Retry-After when a client is genuinely throttled', async () => {
      const app = harness({ trustedProxies }, { '/get-session': { window: 45, max: 1 } });

      await app.request('/get-session', PROD_CHAIN(CLIENT_A));
      const blocked = await app.request('/get-session', PROD_CHAIN(CLIENT_A));

      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('X-Retry-After')).toBe('45');
    });

    it('lets a normal office sign-in burst through from one shared egress IP', async () => {
      const app = harness({ trustedProxies });
      const OFFICE_IP = '203.0.113.77';

      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await app.request(
          '/sign-in/email',
          PROD_CHAIN(OFFICE_IP),
          signIn(`staff${i}@example.com`),
        );
        statuses.push(res.status);
      }

      // Twelve staff signing in within a minute from one NAT. Under Better
      // Auth's default rule (3 per 10s) this burst is rejected.
      expect(statuses).not.toContain(429);
    });
  });

  describe('safety net when IP resolution breaks anyway', () => {
    it('never 429s the shared read bucket, but still records it for diagnosis', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      // No trustedProxies → unresolvable chain, and a ceiling of 1 so a second
      // request would be rejected if the shared bucket were enforced.
      const app = harness(undefined, { '/get-session': { window: 60, max: 1 } });

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await app.request('/get-session', PROD_CHAIN(CLIENT_A))).status);
        statuses.push((await app.request('/get-session', PROD_CHAIN(CLIENT_B))).status);
      }

      // A misconfiguration degrades to "not rate limited", never to
      // "everyone is signed out".
      expect(statuses).not.toContain(429);
      // The key is still recorded, so the condition stays diagnosable.
      expect(app.keys()).toContain('no-trusted-ip|/get-session');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('no-trusted-ip'));
      error.mockRestore();
    });

    // The fail-open above is scoped to the read endpoints. It used to cover
    // every path, which meant a wrong TRUSTED_PROXY_CIDRS — or a client inside
    // a trusted range — left `/sign-in` with no limit at all: unlimited
    // password guessing, and unlimited `/request-password-reset` mail sends.
    it('still 429s a credential endpoint once the shared ceiling is passed', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      // No trustedProxies → unresolvable chain. max 1 → shared ceiling of
      // SHARED_BUCKET_MAX_MULTIPLIER requests before enforcement bites.
      const app = harness(undefined, { '/sign-in/email': { window: 60, max: 1 } });

      const statuses: number[] = [];
      for (let i = 0; i < SHARED_BUCKET_MAX_MULTIPLIER + 2; i++) {
        statuses.push(
          (
            await app.request('/sign-in/email', PROD_CHAIN(CLIENT_A), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: 'nobody@test.dev', password: 'guess-me-please' }),
            })
          ).status,
        );
      }

      expect(statuses.slice(0, SHARED_BUCKET_MAX_MULTIPLIER)).not.toContain(429);
      expect(statuses.at(-1)).toBe(429);
      expect(app.keys()).toContain('no-trusted-ip|/sign-in/email');
      error.mockRestore();
    });
  });
});
