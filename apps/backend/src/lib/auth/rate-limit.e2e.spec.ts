/* eslint-disable @typescript-eslint/no-require-imports */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import {
  RATE_LIMIT_CUSTOM_RULES,
  createRedisRateLimitStorage,
  parseTrustedProxies,
} from './rate-limit';

/**
 * The same proof as `rate-limit.integration.spec.ts`, but over real sockets.
 *
 * The other suite hands Better Auth a `Request` object it constructs itself.
 * This one stands up an actual HTTP server behind an actual chain of reverse
 * proxies, each appending to `x-forwarded-for` the way nginx's
 * `$proxy_add_x_forwarded_for` does, and drives it with real requests through
 * `toNodeHandler` — the exact adapter `main.ts` mounts. It covers the seam the
 * other suite cannot: that the header survives the hop chain and reaches
 * `getIp()` in the shape we think it does.
 */

// Each test stands up several HTTP servers; the default 5s budget is tight.
jest.setTimeout(60_000);

const REAL_NODE_ENV = process.env.NODE_ENV;

function loadBetterAuthAsProduction() {
  process.env.NODE_ENV = 'production';
  let loaded: {
    betterAuth: (options: unknown) => { handler: unknown };
    memoryAdapter: (data: unknown) => unknown;
    toNodeHandler: (auth: unknown) => http.RequestListener;
  };
  try {
    jest.isolateModules(() => {
      loaded = {
        betterAuth: require('better-auth').betterAuth,
        memoryAdapter: require('better-auth/adapters/memory').memoryAdapter,
        toNodeHandler: require('better-auth/node').toNodeHandler,
      };
    });
  } finally {
    process.env.NODE_ENV = REAL_NODE_ENV;
  }
  return loaded!;
}

function fakeRedis() {
  const counters = new Map<string, number>();
  const redis = {
    eval: (_script: string, _numKeys: number, key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return Promise.resolve(next);
    },
    get: () => Promise.resolve(null),
    set: () => Promise.resolve('OK'),
  };
  return { redis: redis as unknown as Redis, counters };
}

const servers: http.Server[] = [];

function listen(server: http.Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/**
 * `fetch` that drains the response body.
 *
 * An unread body keeps its socket checked out of undici's pool, and every
 * deployment below binds a fresh port — a new pool origin — so leaving bodies
 * unread grows that pool for the whole run and leaves the servers with live
 * connections they can never close.
 */
async function call(
  url: string,
  init?: Parameters<typeof fetch>[1],
): Promise<Awaited<ReturnType<typeof fetch>>> {
  const res = await fetch(url, init);
  await res.arrayBuffer();
  return res;
}

/**
 * A reverse proxy hop. `edge` mirrors the internet-facing nginx, whose
 * `$remote_addr` is the browser; the socket address here is always loopback, so
 * the client IP is injected. Inner hops append their own `$remote_addr`, which
 * is exactly what `$proxy_add_x_forwarded_for` produces.
 */
function proxyHop(upstream: string, opts: { edge?: string } = {}) {
  return http.createServer((req, res) => {
    const raw = req.headers['x-forwarded-for'];
    const inbound = Array.isArray(raw) ? raw.join(', ') : raw;
    const remote = opts.edge ?? req.socket.remoteAddress?.replace('::ffff:', '') ?? '127.0.0.1';
    const forwarded = opts.edge ? remote : inbound ? `${inbound}, ${remote}` : remote;

    const proxied = http.request(
      `${upstream}${req.url}`,
      {
        method: req.method,
        headers: { ...req.headers, host: new URL(upstream).host, 'x-forwarded-for': forwarded },
        // Pooling these would outlive the servers they point at.
        agent: false,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    proxied.on('error', () => {
      res.writeHead(502).end();
    });
    req.pipe(proxied);
  });
}

interface Deployment {
  /**
   * Stands up an internet-facing nginx for one client address. Several can
   * front the same backend, which is how two clients on two networks are
   * simulated.
   */
  edgeFor: (clientIp: string) => Promise<string>;
  keys: () => string[];
}

/**
 * browser → edge nginx → Next auth proxy → backend nginx → NestJS,
 * i.e. the self-hosted blue/green topology.
 */
async function deploy(ipAddress?: { trustedProxies: string[] }): Promise<Deployment> {
  const { betterAuth, memoryAdapter, toNodeHandler } = loadBetterAuthAsProduction();
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
      customRules: RATE_LIMIT_CUSTOM_RULES,
      customStorage: createRedisRateLimitStorage(redis),
    },
  });

  const app = await listen(http.createServer(toNodeHandler(auth)));
  const backendNginx = await listen(proxyHop(app));
  const nextProxy = await listen(proxyHop(backendNginx));

  return {
    edgeFor: (clientIp: string) => listen(proxyHop(nextProxy, { edge: clientIp })),
    keys: () => [...counters.keys()],
  };
}

const TRUSTED = parseTrustedProxies(undefined);
const CLIENT_A = '203.0.113.10';
const CLIENT_B = '198.51.100.20';

describe('Better Auth rate limiting over a real proxy chain', () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            // `close` only stops new connections. Anything still connected
            // keeps the server — and its buffers — alive indefinitely.
            s.closeAllConnections();
            s.close(() => resolve());
          }),
      ),
    );
  });

  it('builds the multi-hop x-forwarded-for chain the fix has to handle', async () => {
    // Proves the topology under test is the real one: three hops, so the
    // header carries three addresses by the time it reaches the app.
    let seen: string | undefined;
    const app = await listen(
      http.createServer((req, res) => {
        seen = req.headers['x-forwarded-for'] as string;
        res.writeHead(200).end('{}');
      }),
    );
    const backendNginx = await listen(proxyHop(app));
    const nextProxy = await listen(proxyHop(backendNginx));
    const edgeNginx = await listen(proxyHop(nextProxy, { edge: CLIENT_A }));

    await call(`${edgeNginx}/api/auth/get-session`);

    expect(seen?.split(',').map((s) => s.trim())).toEqual([CLIENT_A, '127.0.0.1', '127.0.0.1']);
  });

  it('collapses onto the shared bucket without trustedProxies', async () => {
    const deployment = await deploy();
    const edge = await deployment.edgeFor(CLIENT_A);

    await call(`${edge}/api/auth/get-session`);

    expect(deployment.keys()).toEqual(['no-trusted-ip|/get-session']);
  });

  it('resolves the real client with trustedProxies configured', async () => {
    const deployment = await deploy({ trustedProxies: TRUSTED });
    const edge = await deployment.edgeFor(CLIENT_A);

    await call(`${edge}/api/auth/get-session`);

    expect(deployment.keys()).toEqual([`${CLIENT_A}|/get-session`]);
  });

  it('gives two clients on two networks separate buckets', async () => {
    const deployment = await deploy({ trustedProxies: TRUSTED });

    await call(`${await deployment.edgeFor(CLIENT_A)}/api/auth/get-session`);
    await call(`${await deployment.edgeFor(CLIENT_B)}/api/auth/get-session`);

    expect(deployment.keys().sort()).toEqual(
      [`${CLIENT_A}|/get-session`, `${CLIENT_B}|/get-session`].sort(),
    );
  });

  it('429s only the client that exceeded its own limit', async () => {
    const deployment = await deploy({ trustedProxies: TRUSTED });
    const noisyNeighbour = await deployment.edgeFor(CLIENT_A);
    const victim = await deployment.edgeFor(CLIENT_B);

    // /request-password-reset carries the tightest per-client rule, so the
    // flood is a handful of requests rather than hundreds.
    const rule = RATE_LIMIT_CUSTOM_RULES['/request-password-reset'];
    const resetRequest = (email: string) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, redirectTo: '/' }),
    });

    const statuses: number[] = [];
    for (let i = 0; i < rule.max + 2; i++) {
      const res = await call(
        `${noisyNeighbour}/api/auth/request-password-reset`,
        resetRequest('someone@example.com'),
      );
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);

    const other = await call(
      `${victim}/api/auth/request-password-reset`,
      resetRequest('other@example.com'),
    );

    // The whole bug in one assertion: before the fix, CLIENT_B was throttled by
    // what CLIENT_A did.
    expect(other.status).not.toBe(429);
  });
});
