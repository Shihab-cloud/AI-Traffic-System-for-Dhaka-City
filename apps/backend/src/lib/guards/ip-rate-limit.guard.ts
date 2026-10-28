import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import type Redis from 'ioredis';

import { SHARED_BUCKET_MAX_MULTIPLIER } from '../auth/rate-limit';
import { RATE_LIMIT_KEY, type RateLimitRule } from '../decorators/rate-limit.decorator';
import { REDIS_CLIENT } from '../providers/redis.provider';
import { isPrivateAddress, resolveClientIp } from '../utils/client-ip.util';

/** Bucket used when no trustworthy client IP can be resolved. */
const SHARED_BUCKET = 'no-trusted-ip';

const KEY_PREFIX = 'http-rl:';

/**
 * INCR plus EXPIRE-on-create in one round trip. The TTL is set only when the
 * counter is created, so the window is fixed from the first request rather than
 * sliding forward on every hit — mirroring `createRedisRateLimitStorage`.
 */
const INCR_WITH_TTL = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

/**
 * IpRateLimitGuard — per-client-IP fixed-window limiter for Nest routes.
 *
 * Registered globally, but returns early (`canActivate → true`) on any route
 * without `@RateLimit()`, so it is a pure no-op for the vast majority of
 * endpoints. It must be registered **before** `AuthGuard` so that unauthenticated
 * floods are rejected before any token or DB work happens.
 *
 * ## Why not Better Auth's limiter
 *
 * That limiter is mounted inside Better Auth's own handler and only sees
 * `/api/auth/*`. Nest routes — including every MFA endpoint — bypass it. See
 * `rate-limit.decorator.ts` for the concrete gap this closes.
 *
 * ## Client IP resolution
 *
 * Reuses Better Auth's `getIPFromHeader` with the same `TRUSTED_PROXY_CIDRS`
 * list, so both limiters bucket a given client identically. The leftmost XFF
 * entry is spoofable, so the chain is walked right-to-left down to the first
 * untrusted hop. When that yields nothing, the request lands in a single shared
 * bucket whose ceiling is `max * SHARED_BUCKET_MAX_MULTIPLIER` — bounded, so a
 * misconfigured proxy cannot remove the limit entirely, but loose enough that
 * legitimate traffic is not collectively locked out by one abuser.
 *
 * ## Redis unavailable
 *
 * Fails **open**, warned once, matching `createRedisRateLimitStorage`: failing
 * closed would take MFA login down entirely whenever Redis blips.
 *
 * Be clear about what that costs, and about what still covers it. Two bounds
 * survive a Redis outage because both live in the database:
 *
 *   - the per-challenge `attemptsRemaining` counter (5, on the
 *     `mfa_challenges` row), which bounds one challenge; and
 *   - the per-user lockout in `login-attempt.store` (10 failures per 15
 *     minutes, keyed on userId), which bounds a caller who keeps opening fresh
 *     challenges to dodge the first.
 *
 * So an attacker who already has the password is still stopped by the account
 * lockout while this guard is open. What is lost is the *per-address* bound:
 * an unauthenticated flood spread across many accounts is unthrottled, and the
 * DB work each request costs is no longer rejected before `AuthGuard` runs.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(IpRateLimitGuard.name);
  private redisFailureWarned = false;
  private privateIpWarned = false;

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.resolveBucketIp(request);
    const isSharedBucket = ip === SHARED_BUCKET;
    const max = isSharedBucket ? rule.max * SHARED_BUCKET_MAX_MULTIPLIER : rule.max;

    // Keyed on the route pattern, not the concrete URL: `/mfa/trusted-devices/:id`
    // must share one bucket rather than handing the caller a fresh window per id.
    const key = `${KEY_PREFIX}${ip}|${request.method} ${routePattern(request)}`;

    const count = await this.increment(key, rule.window);
    if (count === null) return true; // Redis unreachable — fail open.

    if (count > max) {
      throw new HttpException(
        {
          error: 'rate_limited',
          message: 'Too many requests. Try again shortly.',
          retryAfter: rule.window,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Shares `resolveClientIp` with the audit path so one client is identified
   * identically everywhere. An unresolvable chain returns `null` there; here it
   * becomes the shared bucket rather than falling back to the nearest proxy
   * hop, which would bucket every client behind that proxy together under a key
   * the caller can influence.
   *
   * A *private* resolved address means the same thing in practice — either
   * `x-forwarded-for` is missing entirely and we are seeing a proxy's bridge
   * address, or `TRUSTED_PROXY_CIDRS` is wrong. Treating that as a real client
   * IP would give one shared bucket the single-client ceiling and 429 everyone
   * behind it, so it goes to the shared bucket and its raised ceiling instead,
   * with a one-time error so the misconfiguration is visible.
   */
  private resolveBucketIp(request: Request): string {
    const ip = resolveClientIp(request);
    if (ip === null) return SHARED_BUCKET;

    if (isPrivateAddress(ip)) {
      if (!this.privateIpWarned && process.env.NODE_ENV === 'production') {
        this.privateIpWarned = true;
        this.logger.error(
          `Resolved a private client IP (${ip}) — TRUSTED_PROXY_CIDRS is likely wrong, or the ` +
            'reverse proxy is not setting x-forwarded-for. Rate-limited routes are falling back ' +
            'to one shared bucket, so limits are no longer per-client.',
        );
      }
      return SHARED_BUCKET;
    }

    return ip;
  }

  private async increment(key: string, windowSeconds: number): Promise<number | null> {
    try {
      const count = await this.redis.eval(
        INCR_WITH_TTL,
        1,
        key,
        String(Math.max(1, windowSeconds)),
      );
      return Number(count);
    } catch (e) {
      if (!this.redisFailureWarned) {
        this.redisFailureWarned = true;
        this.logger.error(
          'Rate-limit storage is unreachable — rate-limited routes are NOT being limited ' +
            'while this persists. Enforcing would fail every MFA login closed, which is ' +
            'worse than an unenforced window.',
          e instanceof Error ? e.stack : String(e),
        );
      }
      return null;
    }
  }
}

/**
 * The matched route's pattern (`/mfa/trusted-devices/:deviceId`), falling back
 * to the concrete path.
 *
 * Express types `request.route` as `any`, so it is narrowed here rather than
 * dereferenced inline — the bucket key is security-relevant, and an `any` that
 * silently yields `undefined` would collapse every route into one bucket.
 */
function routePattern(request: Request): string {
  const route: unknown = (request as { route?: unknown }).route;
  if (route && typeof route === 'object' && 'path' in route) {
    const { path } = route;
    if (typeof path === 'string') return path;
  }
  return request.path;
}
