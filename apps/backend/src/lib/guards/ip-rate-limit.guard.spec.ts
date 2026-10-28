import { ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';

import { RATE_LIMIT_KEY, type RateLimitRule } from '../decorators/rate-limit.decorator';
import { resetTrustedProxyCache } from '../utils/client-ip.util';
import { IpRateLimitGuard } from './ip-rate-limit.guard';

const RULE: RateLimitRule = { window: 60, max: 3 };

function makeContext(headers: Record<string, string | string[]> = {}, peer = '203.0.113.9') {
  const request = {
    method: 'POST',
    path: '/mfa/login/verify',
    route: { path: '/mfa/login/verify' },
    headers,
    ip: peer,
    socket: { remoteAddress: peer },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function makeGuard(opts: {
  rule?: RateLimitRule;
  counts?: number[];
  evalImpl?: () => Promise<unknown>;
  trustedProxies?: string;
}) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === RATE_LIMIT_KEY ? opts.rule : undefined),
  } as unknown as Reflector;

  // `resolveClientIp` reads the env directly (param decorators are outside DI)
  // and memoizes, so the cache is reset per-guard.
  if (opts.trustedProxies === undefined) {
    delete process.env.TRUSTED_PROXY_CIDRS;
  } else {
    process.env.TRUSTED_PROXY_CIDRS = opts.trustedProxies;
  }
  resetTrustedProxyCache();

  const queue = [...(opts.counts ?? [])];
  const evalCalls: unknown[][] = [];
  const redis = {
    eval: opts.evalImpl
      ? opts.evalImpl
      : (...args: unknown[]) => {
          evalCalls.push(args);
          return Promise.resolve(queue.shift() ?? 1);
        },
  } as unknown as Redis;

  return { guard: new IpRateLimitGuard(reflector, redis), evalCalls };
}

describe('IpRateLimitGuard', () => {
  const originalTrustedProxies = process.env.TRUSTED_PROXY_CIDRS;

  afterAll(() => {
    if (originalTrustedProxies === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
    else process.env.TRUSTED_PROXY_CIDRS = originalTrustedProxies;
    resetTrustedProxyCache();
  });

  it('is a no-op on routes without @RateLimit()', async () => {
    const { guard, evalCalls } = makeGuard({ rule: undefined });

    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(evalCalls).toHaveLength(0);
  });

  it('allows requests up to the ceiling and rejects the one past it', async () => {
    const { guard } = makeGuard({ rule: RULE, counts: [1, 2, 3, 4] });
    const ctx = makeContext();

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('returns 429 with a retryAfter matching the window', async () => {
    const { guard } = makeGuard({ rule: RULE, counts: [99] });

    await expect(guard.canActivate(makeContext())).rejects.toMatchObject({
      status: 429,
      response: { error: 'rate_limited', retryAfter: 60 },
    });
  });

  it('keys on the route pattern, not the concrete URL', async () => {
    const { guard, evalCalls } = makeGuard({ rule: RULE, counts: [1] });
    const request = {
      method: 'DELETE',
      path: '/mfa/trusted-devices/abc123',
      route: { path: '/mfa/trusted-devices/:deviceId' },
      headers: {},
      ip: '203.0.113.9',
      socket: { remoteAddress: '203.0.113.9' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;

    await guard.canActivate(ctx);

    expect(evalCalls[0][2]).toBe('http-rl:203.0.113.9|DELETE /mfa/trusted-devices/:deviceId');
  });

  it('resolves the client IP through the trusted-proxy chain', async () => {
    const { guard, evalCalls } = makeGuard({
      rule: RULE,
      counts: [1],
      trustedProxies: '172.16.0.0/12',
    });

    await guard.canActivate(
      makeContext({ 'x-forwarded-for': '198.51.100.7, 172.18.0.7, 172.18.0.3' }, '172.18.0.3'),
    );

    expect(evalCalls[0][2]).toBe('http-rl:198.51.100.7|POST /mfa/login/verify');
  });

  it('buckets an unresolvable chain under a shared key rather than the nearest hop', async () => {
    // Every hop is inside the default trusted range (172.16/12), so the
    // right-to-left walk runs off the left end and yields no client IP.
    const { guard, evalCalls } = makeGuard({ rule: RULE, counts: [1] });

    await guard.canActivate(
      makeContext({ 'x-forwarded-for': '172.18.0.5, 172.18.0.3' }, '172.18.0.3'),
    );

    expect(evalCalls[0][2]).toBe('http-rl:no-trusted-ip|POST /mfa/login/verify');
  });

  it('raises the ceiling for the shared bucket so one abuser cannot lock everyone out', async () => {
    // max 3 * SHARED_BUCKET_MAX_MULTIPLIER (10) = 30 allowed.
    const { guard } = makeGuard({ rule: RULE, counts: [30, 31] });
    const ctx = makeContext({ 'x-forwarded-for': '172.18.0.5, 172.18.0.3' }, '172.18.0.3');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('ignores x-forwarded-for when the request did not come from a trusted proxy', async () => {
    // The peer wrote the header itself. Honouring it would hand the caller a
    // fresh bucket per request just by varying the value.
    const { guard, evalCalls } = makeGuard({
      rule: RULE,
      counts: [1, 2],
      trustedProxies: '172.16.0.0/12',
    });

    await guard.canActivate(makeContext({ 'x-forwarded-for': '198.51.100.7' }, '203.0.113.9'));
    await guard.canActivate(makeContext({ 'x-forwarded-for': '198.51.100.8' }, '203.0.113.9'));

    expect(evalCalls.map((call) => call[2])).toEqual([
      'http-rl:203.0.113.9|POST /mfa/login/verify',
      'http-rl:203.0.113.9|POST /mfa/login/verify',
    ]);
  });

  it('fails open when Redis is unreachable, and says so exactly once', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { guard } = makeGuard({
      rule: RULE,
      evalImpl: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);

    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
