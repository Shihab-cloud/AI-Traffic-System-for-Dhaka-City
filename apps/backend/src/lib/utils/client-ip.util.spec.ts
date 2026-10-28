import type { Request } from 'express';

import { isPrivateAddress, resetTrustedProxyCache, resolveClientIp } from './client-ip.util';

function makeRequest(peer: string, forwardedFor?: string | string[]): Request {
  return {
    ip: peer,
    socket: { remoteAddress: peer },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  } as unknown as Request;
}

describe('resolveClientIp', () => {
  const original = process.env.TRUSTED_PROXY_CIDRS;

  function withTrustedProxies(value: string | undefined) {
    if (value === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
    else process.env.TRUSTED_PROXY_CIDRS = value;
    resetTrustedProxyCache();
  }

  afterEach(() => {
    withTrustedProxies(original);
  });

  it('returns the peer address when there is no forwarded header', () => {
    withTrustedProxies('172.16.0.0/12');

    expect(resolveClientIp(makeRequest('203.0.113.9'))).toBe('203.0.113.9');
  });

  it('walks the chain to the first untrusted hop when the peer is a trusted proxy', () => {
    withTrustedProxies('172.16.0.0/12');

    const ip = resolveClientIp(makeRequest('172.18.0.3', '198.51.100.7, 172.18.0.7, 172.18.0.3'));

    expect(ip).toBe('198.51.100.7');
  });

  it('ignores a forwarded header written by an untrusted peer', () => {
    // The whole point of the trusted-proxy list: a client that can reach the
    // backend directly must not be able to name its own address.
    withTrustedProxies('172.16.0.0/12');

    const ip = resolveClientIp(makeRequest('203.0.113.9', '198.51.100.7'));

    expect(ip).toBe('203.0.113.9');
  });

  it('returns null when every hop in the chain is trusted', () => {
    withTrustedProxies('172.16.0.0/12');

    expect(resolveClientIp(makeRequest('172.18.0.3', '172.18.0.5, 172.18.0.3'))).toBeNull();
  });

  it('joins a repeated x-forwarded-for header before resolving', () => {
    withTrustedProxies('172.16.0.0/12');

    const ip = resolveClientIp(makeRequest('172.18.0.3', ['198.51.100.7', '172.18.0.3']));

    expect(ip).toBe('198.51.100.7');
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.1.1',
    '100.64.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
  ])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['203.0.113.9', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1'])(
    'treats %s as public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});
