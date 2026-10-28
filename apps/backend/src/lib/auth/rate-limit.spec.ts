import type Redis from 'ioredis';
import {
  DEFAULT_TRUSTED_PROXY_CIDRS,
  RATE_LIMIT_CUSTOM_RULES,
  SHARED_BUCKET_FAIL_OPEN_PATHS,
  SHARED_BUCKET_KEY_PREFIX,
  SHARED_BUCKET_MAX_MULTIPLIER,
  createRedisRateLimitStorage,
  parseTrustedProxies,
} from './rate-limit';

describe('parseTrustedProxies', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('falls back to the Docker-bridge defaults when unset or blank', () => {
    expect(parseTrustedProxies(undefined)).toEqual([...DEFAULT_TRUSTED_PROXY_CIDRS]);
    expect(parseTrustedProxies('')).toEqual([...DEFAULT_TRUSTED_PROXY_CIDRS]);
    expect(parseTrustedProxies('  ,  ,')).toEqual([...DEFAULT_TRUSTED_PROXY_CIDRS]);
  });

  it('splits and trims a comma-separated list', () => {
    expect(parseTrustedProxies('172.16.0.0/12, 10.1.2.3 ,::1')).toEqual([
      '172.16.0.0/12',
      '10.1.2.3',
      '::1',
    ]);
  });

  it('accepts bare addresses and CIDR ranges in both families', () => {
    const entries = ['127.0.0.1', '127.0.0.0/8', '::1', 'fd00::/8', '2001:db8::1'];
    expect(parseTrustedProxies(entries.join(','))).toEqual(entries);
  });

  it('drops malformed entries with a warning but keeps the valid ones', () => {
    expect(parseTrustedProxies('172.16.0.0/12,not-an-ip,10.0.0.0/8x,999.1.1.1')).toEqual([
      '172.16.0.0/12',
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-an-ip'));
  });

  it('rejects out-of-range prefixes', () => {
    expect(parseTrustedProxies('10.0.0.0/33,10.0.0.0/24')).toEqual(['10.0.0.0/24']);
    expect(parseTrustedProxies('fd00::/129,fd00::/8')).toEqual(['fd00::/8']);
  });

  // These four are the reason validation delegates to Better Auth's own
  // `findInvalidTrustedProxies` instead of a local regex. A character class of
  // `[0-9a-fA-F:]` accepts all of them, so the entry passed our check, was
  // logged as configured, and was then dropped inside Better Auth's `parseCIDR`
  // — leaving the instance on the shared bucket with no warning that mattered.
  it('rejects IPv6 forms that Better Auth itself will not parse', () => {
    for (const entry of ['1:2:3:4:5:6:7:8:9', 'fd00::::1', ':::', '1::2::3']) {
      expect(parseTrustedProxies(`172.16.0.0/12,${entry}`)).toEqual(['172.16.0.0/12']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(entry));
    }
  });

  // Better Auth disengages chain-walking entirely when *no* entry parses, which
  // would silently put the instance back on the shared bucket. Falling back to
  // the defaults keeps IP resolution working while the typo is fixed.
  it('falls back to defaults when every entry is invalid', () => {
    expect(parseTrustedProxies('nonsense,also-nonsense')).toEqual([...DEFAULT_TRUSTED_PROXY_CIDRS]);
  });

  // Trusting a range that can also contain a *client* breaks resolution twice
  // over: the client can forge the leftmost entry, and — worse — the
  // right-to-left walk runs off the left end of the chain and returns null, so
  // the client lands in the shared bucket. Verified against Better Auth 1.6.23:
  // with 192.168.0.0/16 trusted, `192.168.1.5, 172.18.0.7, 172.18.0.3` resolves
  // to null; without it, to 192.168.1.5.
  it('does not trust common client ranges by default', () => {
    expect(DEFAULT_TRUSTED_PROXY_CIDRS).not.toContain('10.0.0.0/8');
    expect(DEFAULT_TRUSTED_PROXY_CIDRS).not.toContain('192.168.0.0/16');
  });
});

describe('RATE_LIMIT_CUSTOM_RULES', () => {
  // The reported symptom. Better Auth's built-in rule is 3 per 10s, which is
  // sized for one user per IP; a shared office egress address blows through it.
  it('lifts /sign-in off the 3-per-10s default', () => {
    const rule = RATE_LIMIT_CUSTOM_RULES['/sign-in/*'];
    expect(rule).toBeDefined();
    expect(rule.max / rule.window).toBeGreaterThan(3 / 10);
    expect(rule.max).toBeGreaterThanOrEqual(30);
  });

  it('gives /get-session and /token room for the proxy fan-out', () => {
    expect(RATE_LIMIT_CUSTOM_RULES['/get-session']).toEqual({ window: 60, max: 1000 });
    expect(RATE_LIMIT_CUSTOM_RULES['/token'].max).toBeGreaterThanOrEqual(100);
  });

  it('keeps every rule positive and bounded', () => {
    for (const [path, rule] of Object.entries(RATE_LIMIT_CUSTOM_RULES)) {
      expect(path.startsWith('/')).toBe(true);
      expect(rule.window).toBeGreaterThan(0);
      expect(rule.max).toBeGreaterThan(0);
    }
  });
});

describe('createRedisRateLimitStorage', () => {
  /**
   * Stands in for the two Lua round trips. Models the counter as the hash the
   * scripts actually write (`count` + `lastRequest`) and records the TTL, so a
   * test can assert the window is set on creation, never extended by a hit, and
   * never stripped by a legacy write.
   */
  function fakeRedis(options: { failing?: boolean } = {}) {
    const hashes = new Map<string, { count: number; lastRequest: number }>();
    const ttls = new Map<string, number>();

    const redis = {
      eval: jest.fn(async (script: string, _numKeys: number, key: string, ...argv: string[]) => {
        if (options.failing) throw new Error('READONLY You cannot write against a replica');

        if (script.includes('HINCRBY')) {
          const [ttl, now] = argv;
          const entry = hashes.get(key) ?? { count: 0, lastRequest: 0 };
          entry.count += 1;
          entry.lastRequest = Number(now);
          hashes.set(key, entry);
          if (entry.count === 1) ttls.set(key, Number(ttl));
          return entry.count;
        }

        // SET_WITH_TTL: applies the fallback window only when the key has none.
        const [count, lastRequest, fallbackWindow] = argv;
        hashes.set(key, { count: Number(count), lastRequest: Number(lastRequest) });
        if (!ttls.has(key)) ttls.set(key, Number(fallbackWindow));
        return 1;
      }),
      hgetall: jest.fn(async (key: string) => {
        const entry = hashes.get(key);
        if (!entry) return {};
        return { count: String(entry.count), lastRequest: String(entry.lastRequest) };
      }),
    };

    return { redis: redis as unknown as Redis, hashes, ttls };
  }

  let log: jest.SpyInstance;

  beforeEach(() => {
    // `consume` logs the first resolved client IP once per process.
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('allows requests up to max, then blocks with retryAfter', async () => {
    const { redis } = fakeRedis();
    const storage = createRedisRateLimitStorage(redis);
    const rule = { window: 60, max: 3 };

    const results: { allowed: boolean; retryAfter: number | null }[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await storage.consume('203.0.113.10|/sign-in/email', rule));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results[3].retryAfter).toBe(60);
  });

  it('keys buckets per client — one client cannot exhaust another', async () => {
    const { redis } = fakeRedis();
    const storage = createRedisRateLimitStorage(redis);
    const rule = { window: 60, max: 2 };

    await storage.consume('203.0.113.10|/get-session', rule);
    await storage.consume('203.0.113.10|/get-session', rule);
    const noisyNeighbour = await storage.consume('203.0.113.10|/get-session', rule);
    const otherUser = await storage.consume('198.51.100.20|/get-session', rule);

    expect(noisyNeighbour.allowed).toBe(false);
    expect(otherUser.allowed).toBe(true);
  });

  it('applies the window TTL on creation and never extends it', async () => {
    const { redis, ttls } = fakeRedis();
    const storage = createRedisRateLimitStorage(redis);

    await storage.consume('203.0.113.10|/token', { window: 60, max: 10 });
    await storage.consume('203.0.113.10|/token', { window: 60, max: 10 });

    expect(ttls.get('203.0.113.10|/token')).toBe(60);
    // Both calls went through the single atomic script, not a read-then-write.
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  // The resolved address is the one diagnostic for the failure mode that has no
  // other signal: when the trusted list misses a hop, Better Auth returns the
  // last untrusted *proxy* address rather than null, so every client shares one
  // enforced bucket and no `no-trusted-ip` key is ever written.
  it('logs the first resolved client IP once', async () => {
    const { redis } = fakeRedis();
    const storage = createRedisRateLimitStorage(redis);
    const rule = { window: 60, max: 100 };

    await storage.consume('203.0.113.10|/get-session', rule);
    await storage.consume('198.51.100.20|/get-session', rule);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('203.0.113.10'));
  });

  describe('the shared no-trusted-ip bucket', () => {
    let error: jest.SpyInstance;

    beforeEach(() => {
      error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      error.mockRestore();
    });

    // These are the endpoints whose enforcement turned a misconfiguration into
    // an outage: the proxy calls /get-session on every navigation and the
    // browser mints from /token on every page load, so one instance-wide bucket
    // saturates in seconds and every user sees a 429 as a random logout.
    it('does not enforce the read endpoints', async () => {
      const { redis, hashes } = fakeRedis();
      const storage = createRedisRateLimitStorage(redis);
      const rule = { window: 60, max: 2 };
      const key = `${SHARED_BUCKET_KEY_PREFIX}/get-session`;

      const results: { allowed: boolean; retryAfter: number | null }[] = [];
      for (let i = 0; i < 10; i++) results.push(await storage.consume(key, rule));

      expect(results.every((r) => r.allowed)).toBe(true);
      // ...but the counter is still written, so `redis-cli --scan --pattern
      // 'no-trusted-ip*'` stays a working diagnostic.
      expect(hashes.get(key)?.count).toBe(10);
      // Logged loudly, and only once per process.
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('no-trusted-ip'));
    });

    // Blanket fail-open used to cover these too, which meant a wrong
    // TRUSTED_PROXY_CIDRS — or a client whose own address sat inside a trusted
    // range — removed brute-force and mail-bomb protection entirely rather than
    // merely making it coarse.
    it('still bounds credential and mail endpoints', async () => {
      const { redis } = fakeRedis();
      const storage = createRedisRateLimitStorage(redis);
      const rule = { window: 60, max: 2 };
      const ceiling = rule.max * SHARED_BUCKET_MAX_MULTIPLIER;

      const results: { allowed: boolean; retryAfter: number | null }[] = [];
      for (let i = 0; i < ceiling + 2; i++) {
        results.push(await storage.consume(`${SHARED_BUCKET_KEY_PREFIX}/sign-in/email`, rule));
      }

      expect(results.slice(0, ceiling).every((r) => r.allowed)).toBe(true);
      expect(results[ceiling].allowed).toBe(false);
      expect(results[ceiling].retryAfter).toBe(60);
    });

    it('gives the shared bucket more room than a single client', async () => {
      expect(SHARED_BUCKET_MAX_MULTIPLIER).toBeGreaterThan(1);
      // The read endpoints are the ones that must never be enforced here.
      expect(SHARED_BUCKET_FAIL_OPEN_PATHS).toEqual(
        expect.arrayContaining(['/get-session', '/token']),
      );
    });
  });

  // Better Auth's `onRequestRateLimit` awaits `consume` with no error handling
  // of its own, so a rejection fails every /api/auth/* request closed — locking
  // everyone out over a transient Redis blip, which is worse than an unenforced
  // window. The module docstring promises this direction; make it a test.
  it('fails open when Redis is unreachable, and warns once', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { redis } = fakeRedis({ failing: true });
    const storage = createRedisRateLimitStorage(redis);
    const rule = { window: 60, max: 1 };

    const results: { allowed: boolean; retryAfter: number | null }[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await storage.consume('203.0.113.10|/sign-in/email', rule));
    }

    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results.every((r) => r.retryAfter === null)).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Rate-limit storage is unreachable'),
      expect.anything(),
    );
    error.mockRestore();
  });

  describe('the legacy non-atomic contract', () => {
    it('round-trips count and lastRequest', async () => {
      const { redis, hashes } = fakeRedis();
      const storage = createRedisRateLimitStorage(redis);
      const key = '203.0.113.10|/get-session';

      expect(await storage.get(key)).toBeNull();

      hashes.set(key, { count: 7, lastRequest: 1_700_000_000_000 });
      expect(await storage.get(key)).toEqual({ key, count: 7, lastRequest: 1_700_000_000_000 });

      hashes.set(key, { count: NaN, lastRequest: 0 });
      expect(await storage.get(key)).toBeNull();
    });

    // `decideConsume` resets the window with `now - data.lastRequest >
    // windowInMs`. Fabricating `lastRequest: Date.now()` on every read made
    // that comparison permanently false, so a client that reached `max` could
    // never leave the window on this path.
    it('reports the real lastRequest, not the time of the read', async () => {
      const { redis } = fakeRedis();
      const storage = createRedisRateLimitStorage(redis);
      const key = '203.0.113.10|/sign-in/email';

      await storage.consume(key, { window: 60, max: 10 });
      const before = await storage.get(key);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const after = await storage.get(key);

      expect(after?.lastRequest).toBe(before?.lastRequest);
    });

    // A plain `SET` clears any TTL on the key. One legacy write therefore left
    // a counter that never expired: once it reached `max`, the client was
    // blocked permanently instead of for one window.
    it('never strips the window off a key consume created', async () => {
      const { redis, ttls } = fakeRedis();
      const storage = createRedisRateLimitStorage(redis);
      const key = '203.0.113.10|/sign-in/email';

      await storage.consume(key, { window: 60, max: 10 });
      expect(ttls.get(key)).toBe(60);

      await storage.set(key, { key, count: 3, lastRequest: Date.now() });

      expect(ttls.get(key)).toBe(60);
      expect(await storage.get(key)).toMatchObject({ count: 3 });
    });

    it('applies a window when it has to create the key itself', async () => {
      const { redis, ttls } = fakeRedis();
      const storage = createRedisRateLimitStorage(redis);
      const key = '203.0.113.10|/token';

      await storage.set(key, { key, count: 1, lastRequest: Date.now() });

      expect(ttls.get(key)).toBeGreaterThan(0);
    });
  });
});
