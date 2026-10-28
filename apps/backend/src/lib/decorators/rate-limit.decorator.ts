import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'http.rate_limit';

export interface RateLimitRule {
  /** Window length in seconds. Fixed from the first request in the window. */
  window: number;
  /** Requests allowed per client IP per window. */
  max: number;
}

/**
 * Apply a per-client-IP rate limit to a route.
 *
 * Enforced by `IpRateLimitGuard`, which is registered globally but is a no-op
 * on routes without this decorator.
 *
 * Better Auth's own rate limiter (`lib/auth/rate-limit.ts`) only wraps its own
 * handler and never sees Nest routes, so this is the only IP-level bound on
 * endpoints that accept a secret from an unauthenticated caller (MFA codes,
 * backup codes). Per-user attempt counting in `login-attempt.store` does not
 * cover them — it is sidestepped by rotating the user being targeted.
 *
 * Usage:
 *   @RateLimit({ window: 60, max: 10 })
 *   @Post('login/verify')
 *   verify(...) { ... }
 */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);
