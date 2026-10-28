import { getIPFromHeader } from '@better-auth/core/utils/ip';
import type { Request } from 'express';

import { parseTrustedProxies } from '../auth/rate-limit';

/**
 * The client IP, as far as it can be established honestly.
 *
 * `req.ip` is not used: Express only derives it from `x-forwarded-for` when
 * `trust proxy` is set, which it is not, so behind the documented deployment
 * (nginx → Next rewrite → nginx) it is a fixed Docker-bridge address identical
 * for every user.
 *
 * `x-forwarded-for` is only consulted when the request actually arrived from a
 * trusted proxy. A peer that is not a proxy wrote the header itself, so
 * honouring it there would hand every caller an attacker-chosen identity — a
 * fresh rate-limit bucket per request and forged IPs in the MFA audit log.
 *
 * Within a trusted chain the walk is right-to-left, stopping at the first
 * untrusted hop, and returns `null` if every hop is trusted. Callers should
 * store `null` rather than substituting a proxy address: an absent IP is
 * honest, a wrong one is not.
 */
export function resolveClientIp(req: Request): string | null {
  const peer = req.socket?.remoteAddress ?? req.ip ?? null;
  const header = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(header) ? header.join(',') : header;

  if (forwarded && peer && isTrustedProxy(peer)) {
    return getIPFromHeader(forwarded, { trustedProxies: getTrustedProxies() });
  }

  return peer;
}

/**
 * True when `ip` is loopback, link-local, CGNAT or RFC1918 — it cannot be a
 * real client arriving over the internet, so seeing one as a resolved client IP
 * means the forwarded header is missing or the proxy config is wrong.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  return (
    v4.startsWith('127.') ||
    v4.startsWith('10.') ||
    v4.startsWith('192.168.') ||
    v4.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v4) ||
    ip === '::1' ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    ip.startsWith('fe80:')
  );
}

/**
 * Whether `ip` is covered by `TRUSTED_PROXY_CIDRS`.
 *
 * Expressed as a one-hop walk so the CIDR semantics come from the same matcher
 * that resolves real chains: the walk strips trusted hops from the right, so a
 * single trusted entry leaves nothing and yields `null`.
 */
function isTrustedProxy(ip: string): boolean {
  return getIPFromHeader(ip, { trustedProxies: getTrustedProxies() }) === null;
}

/**
 * Read from `process.env` rather than `ConfigService` so this stays a plain
 * function callable from anywhere holding a request — `IpRateLimitGuard` must
 * agree with the audit path on who a client is.
 */
let trustedProxies: string[] | null = null;
function getTrustedProxies(): string[] {
  trustedProxies ??= parseTrustedProxies(process.env.TRUSTED_PROXY_CIDRS);
  return trustedProxies;
}

/** Test seam — resets the memoized list so a spec can vary the env value. */
export function resetTrustedProxyCache(): void {
  trustedProxies = null;
}
