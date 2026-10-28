import { findInvalidTrustedProxies } from '@better-auth/core/utils/ip';
import type { RateLimit } from 'better-auth/types';
import type Redis from 'ioredis';

/**
 * Better Auth rate limiting — client-IP resolution and per-client buckets.
 *
 * ## Why this file exists
 *
 * Better Auth keys its rate limiter on the client IP resolved by
 * `@better-auth/core/utils/ip#getIp`. That helper reads `x-forwarded-for`, and
 * **with no `advanced.ipAddress.trustedProxies` configured it only trusts a
 * header carrying exactly one address** — a multi-hop chain is unresolvable and
 * yields `null`.
 *
 * Every `/api/auth/*` request in the self-hosted deployment arrives with two or
 * more XFF entries: the frontend nginx and the backend nginx both append via
 * `$proxy_add_x_forwarded_for`, and browser-originated auth calls take an extra
 * hop through the Next rewrite (`/api/auth/:path*` → backend).
 *
 * When the IP is `null`, Better Auth does *not* skip rate limiting — it buckets
 * every request under the single shared key `no-trusted-ip|<path>`. Limits then
 * apply instance-wide rather than per client: one busy user drains the bucket
 * and everyone else gets a 429. On `/get-session` that reads as a random logout;
 * on `/sign-in/*` (Better Auth's default: 3 requests per 10s) it also blocks the
 * user from signing back in.
 *
 * The limiter only runs when `NODE_ENV=production` (`rateLimit.enabled` defaults
 * to `isProduction`) and in development `getIp()` short-circuits to `127.0.0.1`,
 * which is why this never reproduces locally.
 *
 * ## The fix
 *
 * 1. `TRUSTED_PROXY_CIDRS` (env) → `advanced.ipAddress.trustedProxies`. Better
 *    Auth then walks the XFF chain right-to-left, skips trusted hops and returns
 *    the first untrusted address — the real client.
 * 2. {@link RATE_LIMIT_CUSTOM_RULES} replaces defaults that assume one user per
 *    IP. They stay generous because an office behind one NAT still shares a key.
 * 3. {@link createRedisRateLimitStorage} makes the counter atomic, degrades to
 *    "not rate limited" if Redis itself is unreachable, and — should IP
 *    resolution ever fail again — keeps a *bounded* instance-wide limit on the
 *    credential and mail endpoints while letting the high-volume read endpoints
 *    through. See {@link SHARED_BUCKET_FAIL_OPEN_PATHS} for why that split.
 */

/**
 * Key prefix Better Auth uses when it cannot resolve a client IP
 * (`NO_TRUSTED_IP_KEY` in `better-auth/api/rate-limiter`). Requests bucketed
 * under it share one instance-wide counter per path.
 */
export const SHARED_BUCKET_KEY_PREFIX = 'no-trusted-ip|';

/**
 * Default trusted reverse-proxy ranges: loopback plus Docker's default bridge
 * address pool (`172.17.0.0/16`–`172.31.0.0/16`). These are the hops that sit
 * in front of the backend in the self-hosted blue/green stack: the frontend
 * nginx, the Next container running the auth proxy, and the backend nginx all
 * live on a Docker bridge.
 *
 * Deliberately does **not** include `10.0.0.0/8` or `192.168.0.0/16`. Both are
 * common *client* ranges (corporate VPNs, Swarm overlays, home and office
 * LANs), and trusting a range that also covers clients is harmful twice over:
 *
 *  - A client inside the range can forge the leftmost XFF entry and choose its
 *    own bucket.
 *  - Worse, the right-to-left walk runs off the left end of the chain when the
 *    client's *own* address is trusted, so `getIPFromHeader` returns `null` and
 *    the client lands in the shared `no-trusted-ip` bucket. With
 *    `192.168.0.0/16` trusted, `getIPFromHeader('192.168.1.5, 172.18.0.7,
 *    172.18.0.3', ...)` resolves to `null`; without it, to `192.168.1.5`.
 *
 * Docker only allocates `192.168.0.0/16` once the `172.16/12` pool is
 * exhausted. If the bridge really does land in `192.168.x` or `10.x`, set
 * `TRUSTED_PROXY_CIDRS` to the proxy's exact subnet — never a whole RFC1918
 * block that could also contain a browser.
 */
export const DEFAULT_TRUSTED_PROXY_CIDRS = ['127.0.0.0/8', '::1', '172.16.0.0/12'] as const;

/**
 * Parses the `TRUSTED_PROXY_CIDRS` env value (comma-separated IPs or CIDR
 * ranges) into the list handed to `advanced.ipAddress.trustedProxies`.
 *
 * Falls back to {@link DEFAULT_TRUSTED_PROXY_CIDRS} when unset or empty.
 *
 * Validation delegates to Better Auth's own `findInvalidTrustedProxies`, which
 * is the exact predicate its `parseCIDR` applies when it builds the trusted
 * list. Re-deriving that with a regex here was subtly looser — it accepted
 * `1:2:3:4:5:6:7:8:9`, `fd00::::1`, `:::` and `1::2::3` — so a typo passed
 * validation, was logged as configured, and was then silently dropped inside
 * Better Auth, putting the instance straight back on the shared bucket. A
 * character-class regex cannot be kept in sync with an address parser by
 * construction, so we call the parser.
 */
export function parseTrustedProxies(raw?: string): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) return [...DEFAULT_TRUSTED_PROXY_CIDRS];

  const invalid = findInvalidTrustedProxies(entries);
  const valid = entries.filter((entry) => !invalid.includes(entry));

  if (invalid.length > 0) {
    console.warn(
      `[better-auth] Ignoring invalid TRUSTED_PROXY_CIDRS entries: ${invalid.join(', ')}. ` +
        'Each entry must be an IP address or CIDR range (e.g. 172.16.0.0/12).',
    );
  }
  if (valid.length === 0) {
    console.warn(
      '[better-auth] TRUSTED_PROXY_CIDRS contained no valid entries — falling back to defaults ' +
        `(${DEFAULT_TRUSTED_PROXY_CIDRS.join(', ')}).`,
    );
    return [...DEFAULT_TRUSTED_PROXY_CIDRS];
  }
  return valid;
}

/**
 * Per-client limits, replacing Better Auth defaults that assume one user per IP.
 *
 * Paths are relative to `basePath` (`/api/auth`). A `*` matches one path
 * segment. Anything not listed keeps Better Auth's global default of
 * 100 requests per 10s, which is fine once buckets are per client.
 *
 * Sizing note: a key is one *address*, so a whole office behind one NAT shares
 * it. Every value below is set for "a floor of staff on one egress IP", not for
 * a single browser.
 */
export const RATE_LIMIT_CUSTOM_RULES: Record<string, { window: number; max: number }> = {
  // The frontend auth proxy revalidates the session on every navigation, and a
  // single navigation costs several calls (page request + RSC + `<Link>`
  // prefetches), multiplied by every open tab. Cheap read, so keep it high.
  '/get-session': { window: 60, max: 1000 },

  // Short-lived JWT mint. The browser caches it in memory, but every fresh page
  // load and every tab mints one, and a 401 triggers a re-mint.
  '/token': { window: 60, max: 300 },

  // Better Auth's default is 3 per 10s. Anti-brute-force, but per address it
  // also caps a shared office IP — several staff signing in within a minute is
  // normal. Credential stuffing is separately bounded by the MFA login-attempt
  // store, which counts per account rather than per address.
  '/sign-in/*': { window: 60, max: 30 },
  '/sign-up/*': { window: 60, max: 10 },
  '/change-password': { window: 60, max: 10 },
  '/change-email': { window: 60, max: 10 },

  // Email-dispatching endpoints. Kept tight — the cost of abuse is outbound
  // mail — but above the default 3/60s so one shared IP is not a bottleneck.
  '/request-password-reset': { window: 60, max: 10 },
  '/forget-password': { window: 60, max: 10 },
  '/send-verification-email': { window: 60, max: 10 },

  // No `/two-factor/*` entry: MFA lives under `/api/mfa/*`, not Better Auth —
  // see `better-auth.ts`.
  '/magic-link/*': { window: 60, max: 10 },
};

/**
 * Paths that are **not** enforced when requests fall into the shared
 * `no-trusted-ip` bucket.
 *
 * These two are the reason the original outage was an outage: the proxy calls
 * `/get-session` on every navigation and the browser mints from `/token` on
 * every page load, so with one instance-wide bucket they saturate in seconds
 * and every user sees a 429 — which surfaces as a random logout, not as
 * throttling. Their abuse cost is a cheap read, so a misconfiguration should
 * cost enforcement here rather than availability.
 *
 * Every other path keeps a bounded shared limit — see
 * {@link SHARED_BUCKET_MAX_MULTIPLIER}. Blanket fail-open used to apply here
 * too, which meant a wrong `TRUSTED_PROXY_CIDRS` (or a client inside a trusted
 * range) removed brute-force and mail-bomb protection entirely.
 */
export const SHARED_BUCKET_FAIL_OPEN_PATHS: readonly string[] = ['/get-session', '/token'];

/**
 * How much room the shared bucket gets relative to a per-client limit, for the
 * paths that stay enforced.
 *
 * The shared bucket is every client at once, so enforcing a per-client `max`
 * verbatim would throttle a busy tenant. Enforcing nothing leaves credential
 * and mail endpoints unlimited. A multiplier keeps a real ceiling — `/sign-in`
 * becomes 300/60s instance-wide instead of unbounded — while leaving normal
 * traffic well clear of it. This is a degraded mode, not a target state: the
 * `console.error` below is the signal to fix `TRUSTED_PROXY_CIDRS`.
 */
export const SHARED_BUCKET_MAX_MULTIPLIER = 10;

/** Window applied by the legacy `set` path when it has to create a key. */
const LEGACY_DEFAULT_WINDOW_SECONDS = 60;

function sharedBucketPath(key: string): string {
  return key.slice(SHARED_BUCKET_KEY_PREFIX.length);
}

/**
 * Decides a shared-bucket request. Exported for tests — the interesting
 * behaviour is a policy choice, not a Redis detail.
 */
export function decideSharedBucket(
  key: string,
  rule: { window: number; max: number },
  count: number,
): { allowed: boolean; retryAfter: number | null } {
  const path = sharedBucketPath(key);
  if (SHARED_BUCKET_FAIL_OPEN_PATHS.includes(path)) {
    return { allowed: true, retryAfter: null };
  }
  const max = rule.max * SHARED_BUCKET_MAX_MULTIPLIER;
  if (count <= max) return { allowed: true, retryAfter: null };
  return { allowed: false, retryAfter: rule.window };
}

/**
 * Atomic Redis-backed rate-limit storage.
 *
 * Two reasons to supply this rather than letting Better Auth reuse
 * `secondaryStorage`:
 *
 *  - **Atomicity.** Our `secondaryStorage` has no `increment`, so Better Auth
 *    falls back to a non-atomic read-then-write ("Rate limiting is best-effort"
 *    warning at boot) that concurrent requests can walk straight through.
 *  - **A survivable shared bucket.** If IP resolution ever breaks again (new
 *    proxy hop, wrong `TRUSTED_PROXY_CIDRS`), everything lands under
 *    `no-trusted-ip|<path>`. The counter is always written — so `redis-cli
 *    --scan --pattern 'no-trusted-ip*'` remains the diagnostic — and
 *    enforcement follows {@link decideSharedBucket}.
 *
 * Redis being unreachable degrades to "not rate limited". Better Auth's
 * `onRequestRateLimit` awaits `consume` with no error handling of its own, so
 * an unhandled rejection here fails *every* `/api/auth/*` request closed —
 * locking everyone out over a transient Redis blip, which is a worse outcome
 * than an unenforced window.
 *
 * Keys are stored verbatim (`<client-ip>|<path>`), matching what Better Auth
 * would have written, so existing runbook commands keep working. The value is a
 * hash of `count` and `lastRequest` so the legacy non-atomic contract can be
 * served faithfully from the same key.
 */
export function createRedisRateLimitStorage(redis: Redis) {
  // HINCRBY then EXPIRE-on-create, in one round trip. The TTL is applied only
  // when the counter is created, so the window is fixed from the first request
  // rather than sliding forward on every hit.
  const INCR_WITH_TTL = `
    local count = redis.call('HINCRBY', KEYS[1], 'count', 1)
    redis.call('HSET', KEYS[1], 'lastRequest', ARGV[2])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return count
  `;

  // Writes an explicit count/lastRequest, applying the fallback window only if
  // the key has no TTL of its own — so a legacy write can never strip the
  // window off a key that `consume` created. A plain `SET` did exactly that,
  // leaving keys that never expire: once such a key reached `max`, the client
  // was blocked permanently instead of for one window.
  const SET_WITH_TTL = `
    redis.call('HSET', KEYS[1], 'count', ARGV[1], 'lastRequest', ARGV[2])
    if redis.call('PTTL', KEYS[1]) < 0 then
      redis.call('EXPIRE', KEYS[1], ARGV[3])
    end
    return 1
  `;

  let sharedBucketWarned = false;
  let redisFailureWarned = false;
  let resolvedIpLogged = false;

  const increment = async (key: string, ttlSeconds: number): Promise<number | null> => {
    try {
      const count = await redis.eval(
        INCR_WITH_TTL,
        1,
        key,
        String(Math.max(1, ttlSeconds)),
        String(Date.now()),
      );
      return Number(count);
    } catch (e) {
      // Fail open, once-warned. See the note on Redis being unreachable above.
      if (!redisFailureWarned) {
        redisFailureWarned = true;
        console.error(
          '[better-auth] Rate-limit storage is unreachable — requests are NOT being rate ' +
            'limited while this persists. Enforcing would fail every /api/auth/* request ' +
            'closed, which is worse than an unenforced window.',
          e,
        );
      }
      return null;
    }
  };

  return {
    // `get`/`set` are only reached by Better Auth's legacy non-atomic path,
    // which `consume` bypasses (`onRequestRateLimit` prefers `consume` when
    // present). Implemented faithfully anyway: the contract still lists them,
    // and a fabricated `lastRequest` plus a TTL-less `set` are silent
    // lockout bugs if that path is ever taken.
    get: async (key: string): Promise<RateLimit | null> => {
      const raw = await redis.hgetall(key);
      const count = Number(raw?.count);
      if (!Number.isFinite(count)) return null;
      const lastRequest = Number(raw.lastRequest);
      return {
        key,
        count,
        lastRequest: Number.isFinite(lastRequest) ? lastRequest : Date.now(),
      };
    },

    set: async (key: string, value: RateLimit): Promise<void> => {
      await redis.eval(
        SET_WITH_TTL,
        1,
        key,
        String(value.count),
        String(value.lastRequest ?? Date.now()),
        String(LEGACY_DEFAULT_WINDOW_SECONDS),
      );
    },

    consume: async (
      key: string,
      rule: { window: number; max: number },
    ): Promise<{ allowed: boolean; retryAfter: number | null }> => {
      const count = await increment(key, rule.window);
      if (count === null) return { allowed: true, retryAfter: null };

      if (key.startsWith(SHARED_BUCKET_KEY_PREFIX)) {
        if (!sharedBucketWarned) {
          sharedBucketWarned = true;
          console.error(
            '[better-auth] Rate limiting fell back to the shared `no-trusted-ip` bucket — the ' +
              'client IP could not be resolved from `x-forwarded-for`. Read endpoints are NOT ' +
              'enforced and credential/mail endpoints are enforced at ' +
              `${SHARED_BUCKET_MAX_MULTIPLIER}x the per-client limit for the whole instance. ` +
              'Fix TRUSTED_PROXY_CIDRS to match the reverse proxies in front of this service.',
          );
        }
        return decideSharedBucket(key, rule, count);
      }

      // An IP that resolves is not necessarily the *right* IP: if the trusted
      // list does not cover every hop, Better Auth returns the last untrusted
      // proxy address instead of null, and every client silently shares that
      // one enforced bucket. That failure produces no `no-trusted-ip` keys and
      // no error, so log the first address we key on — an operator comparing
      // it against a real client address catches the case immediately.
      if (!resolvedIpLogged) {
        resolvedIpLogged = true;
        const separator = key.lastIndexOf('|');
        console.log(
          `[better-auth] Rate limiting on resolved client IP: ${key.slice(0, separator)}. ` +
            'If this is a proxy address rather than a real client, TRUSTED_PROXY_CIDRS is ' +
            'missing a hop and all clients share this bucket.',
        );
      }

      if (count <= rule.max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: rule.window };
    },
  };
}
