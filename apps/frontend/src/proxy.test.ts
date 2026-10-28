import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeCallbackUrl } from './proxy';

/**
 * The proxy is the auth gate: what it gets wrong either signs everyone out or
 * lets everyone in. These tests pin the three behaviours that the "random
 * logout in production" report turned out to depend on.
 *
 * `better-auth/client` is mocked so each test controls exactly what
 * `get-session` answers — including the failure shapes (429, 5xx, network
 * error) the real backend produces under rate limiting.
 */

type SessionAnswer =
  | { kind: 'session'; data: unknown; setCookie?: string[] }
  | { kind: 'error'; status: number }
  | { kind: 'throw' };

let answer: SessionAnswer = { kind: 'session', data: null };
const getSessionCalls: number[] = [];

vi.mock('better-auth/client', () => ({
  createAuthClient: () => ({
    getSession: async (opts: {
      fetchOptions?: { onResponse?: (ctx: { response: Response }) => void };
    }) => {
      getSessionCalls.push(Date.now());

      if (answer.kind === 'throw') throw new Error('socket hang up');

      const headers = new Headers();
      if (answer.kind === 'session') {
        for (const c of answer.setCookie ?? []) headers.append('set-cookie', c);
      }
      opts.fetchOptions?.onResponse?.({ response: new Response(null, { headers }) });

      if (answer.kind === 'error') {
        return { data: null, error: { status: answer.status, statusText: 'err' } };
      }
      return { data: answer.data, error: null };
    },
  }),
}));

vi.mock('@/lib/auth-fields', () => ({ additionalFieldsPlugin: {} }));

const SESSION = {
  user: { id: 'u1', role: { name: 'USER', permissions: ['USER:SELF_SERVICE'] } },
  session: { id: 's1' },
};

const PROD_COOKIE = '__Secure-better-auth.session_token';
const DEV_COOKIE = 'better-auth.session_token';

function makeRequest(pathname: string, cookies: Record<string, string> = {}) {
  const headers = new Headers();
  const jar = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  if (jar) headers.set('cookie', jar);
  return new NextRequest(new URL(`https://app.test${pathname}`), { headers });
}

/** Fresh module per test so the in-process session cache never leaks across them. */
async function loadProxy() {
  vi.resetModules();
  return (await import('./proxy')).proxy;
}

describe('proxy', () => {
  beforeEach(() => {
    answer = { kind: 'session', data: null };
    getSessionCalls.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recognising the session cookie', () => {
    // In production Better Auth prefixes the cookie with `__Secure-`. Matching
    // only the bare name would make every production request look signed out.
    it('treats the __Secure- prefixed cookie as a session', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));

      expect(getSessionCalls.length).toBe(1);
      expect(res.status).not.toBe(307);
    });

    it('recognises chunked cookies', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION };

      await proxy(
        makeRequest('/settings', {
          [`${PROD_COOKIE}-0`]: 'part0',
          [`${PROD_COOKIE}-1`]: 'part1',
        }),
      );

      expect(getSessionCalls.length).toBe(1);
    });

    it('skips the backend entirely when no session cookie is present', async () => {
      const proxy = await loadProxy();

      const res = await proxy(makeRequest('/settings'));

      expect(getSessionCalls.length).toBe(0);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/auth/signin');
    });
  });

  describe('fail-open when get-session cannot answer', () => {
    // The reported bug: `/get-session` is rate limited, the proxy reads the 429
    // as "no session", and a signed-in user is bounced to signin.
    it('renders the page on 429 instead of redirecting to signin', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'error', status: 429 };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));

      expect(res.status).not.toBe(307);
      expect(res.headers.get('location')).toBeNull();
    });

    it('renders the page on 5xx', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'error', status: 503 };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));
      expect(res.status).not.toBe(307);
    });

    it('renders the page when the request throws', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'throw' };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));
      expect(res.status).not.toBe(307);
    });

    // Fail-open must not become fail-never-sign-out: a 401 is authoritative.
    it('still redirects on an authoritative 401', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'error', status: 401 };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/auth/signin');
    });

    it('clears the prefixed cookie when it does sign the user out', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: null };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));

      const cleared = res.headers.getSetCookie().join('\n');
      expect(cleared).toContain(PROD_COOKIE);
      // A stale `__Secure-` cookie surviving the redirect loops the user
      // through signin on every navigation.
      expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    });
  });

  describe('forwarding the refreshed session cookie', () => {
    // Better Auth refreshes the cookie once per `updateAge` and returns it on
    // the get-session response. Dropping it leaves the browser cookie on its
    // original 7-day maxAge — one hard logout per user, 7 days after sign-in,
    // regardless of activity.
    const REFRESHED = `${PROD_COOKIE}=new-token; Path=/; Max-Age=604800; HttpOnly; Secure`;

    it('replays Set-Cookie onto a rendered page', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION, setCookie: [REFRESHED] };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));

      expect(res.headers.getSetCookie()).toContain(REFRESHED);
    });

    it('replays Set-Cookie onto a redirect too', async () => {
      const proxy = await loadProxy();
      answer = {
        kind: 'session',
        data: { ...SESSION, session: { ...SESSION.session, activation_required: true } },
        setCookie: [REFRESHED],
      };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/auth/activate');
      expect(res.headers.getSetCookie()).toContain(REFRESHED);
    });
  });

  describe('collapsing the get-session fan-out', () => {
    // One navigation costs a document request, its RSC counterpart and every
    // <Link> prefetch. Each used to be its own backend round trip.
    it('serves repeat navigations for the same session from one call', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION };
      const cookies = { [PROD_COOKIE]: 'tok' };

      await Promise.all([
        proxy(makeRequest('/settings', cookies)),
        proxy(makeRequest('/settings', cookies)),
        proxy(makeRequest('/reports', cookies)),
        proxy(makeRequest('/reports', cookies)),
      ]);
      await proxy(makeRequest('/settings', cookies));

      expect(getSessionCalls.length).toBe(1);
    });

    it('does not share a cached session between different cookies', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION };

      await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'user-a' }));
      await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'user-b' }));

      expect(getSessionCalls.length).toBe(2);
    });

    it('re-reads the session once the short window elapses', async () => {
      vi.useFakeTimers();
      try {
        const proxy = await loadProxy();
        answer = { kind: 'session', data: SESSION };
        const cookies = { [DEV_COOKIE]: 'tok' };

        await proxy(makeRequest('/settings', cookies));
        vi.advanceTimersByTime(4_000);
        await proxy(makeRequest('/settings', cookies));

        expect(getSessionCalls.length).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('existing routing behaviour is unchanged', () => {
    it('lets auth API routes through untouched', async () => {
      const proxy = await loadProxy();
      const res = await proxy(makeRequest('/api/auth/get-session'));
      expect(getSessionCalls.length).toBe(0);
      expect(res.status).not.toBe(307);
    });

    it('redirects a signed-in user away from the signin page', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION };

      const res = await proxy(makeRequest('/auth/signin', { [PROD_COOKIE]: 'tok' }));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).not.toContain('/auth/signin');
    });

    it('sends an MFA-enrollment user to setup', async () => {
      const proxy = await loadProxy();
      answer = {
        kind: 'session',
        data: { ...SESSION, session: { ...SESSION.session, enrollment_required: true } },
      };

      const res = await proxy(makeRequest('/settings', { [PROD_COOKIE]: 'tok' }));

      expect(res.headers.get('location')).toContain('/auth/mfa-setup');
    });

    it('leaves a public path alone for a signed-out visitor', async () => {
      const proxy = await loadProxy();
      const res = await proxy(makeRequest('/auth/signin'));
      expect(res.status).not.toBe(307);
    });

    it.each(['/terms', '/privacy-policy'])(
      'opens %s for a signed-out visitor and a signed-in user alike',
      async (path) => {
        // The sign-up form links to both, so they must open before an account exists — and the
        // app footer links to both, so a signed-in user must not be bounced to the dashboard.
        const proxy = await loadProxy();
        expect((await proxy(makeRequest(path))).status).not.toBe(307);

        answer = { kind: 'session', data: SESSION };
        expect((await proxy(makeRequest(path, { [PROD_COOKIE]: 'tok' }))).status).not.toBe(307);
      },
    );

    it.each(['/faq', '/unauthorized'])('does not bounce a signed-in user off %s', async (path) => {
      // Public is not guest-only: a signed-in user following the FAQ link on the not-found page
      // must reach the FAQ, not be sent to their dashboard.
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION };

      const res = await proxy(makeRequest(path, { [PROD_COOKIE]: 'tok' }));

      expect(res.status).not.toBe(307);
    });
  });

  /**
   * The fail-open above must mean "we do not know whether you are signed in",
   * never "there are no gates today". Returning `next()` before the gate checks
   * let any backend 429 or restart carry a temp-password user, or a
   * mandatory-MFA user with no factor enrolled, straight into the app shell.
   */
  describe('the onboarding gates survive a backend outage', () => {
    const cookies = { [PROD_COOKIE]: 'tok' };

    it('keeps sending an unenrolled user to setup when get-session 429s', async () => {
      const proxy = await loadProxy();
      answer = {
        kind: 'session',
        data: { ...SESSION, session: { ...SESSION.session, enrollment_required: true } },
      };
      // One good reading, so the proxy knows this session's gate state.
      await proxy(makeRequest('/auth/mfa-setup', cookies));

      answer = { kind: 'error', status: 429 };
      const res = await proxy(makeRequest('/settings', cookies));

      expect(res.headers.get('location')).toContain('/auth/mfa-setup');
    });

    it('keeps sending a temp-password user to activate when the backend throws', async () => {
      const proxy = await loadProxy();
      answer = {
        kind: 'session',
        data: { ...SESSION, session: { ...SESSION.session, activation_required: true } },
      };
      await proxy(makeRequest('/auth/activate', cookies));

      answer = { kind: 'throw' };
      const res = await proxy(makeRequest('/settings', cookies));

      expect(res.headers.get('location')).toContain('/auth/activate');
    });

    // With nothing remembered there is nothing to enforce, and bouncing to
    // signin is the original reported bug. Render and let the API's own auth
    // decide.
    it('still renders when it has never seen this session', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'error', status: 503 };

      const res = await proxy(makeRequest('/settings', cookies));

      expect(res.status).not.toBe(307);
      expect(res.headers.get('location')).toBeNull();
    });

    it('does not gate a session it last saw as clear', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION };
      await proxy(makeRequest('/settings', cookies));

      answer = { kind: 'error', status: 429 };
      const res = await proxy(makeRequest('/settings', cookies));

      expect(res.status).not.toBe(307);
    });
  });

  /**
   * `callbackUrl` is attacker-controlled on any link a victim can be sent, and
   * `new URL(value, request.url)` resolves an absolute or protocol-relative
   * value against the attacker's origin — so a *signed-in* user gets redirected
   * off-site. The proxy only ever writes a bare pathname into this parameter.
   */
  describe('callbackUrl is not an open redirect', () => {
    const cookies = { [PROD_COOKIE]: 'tok' };

    beforeEach(() => {
      answer = { kind: 'session', data: SESSION };
    });

    it.each([
      'https://evil.com',
      'http://evil.com/path',
      '//evil.com',
      '/\\evil.com',
      'javascript:alert(1)',
    ])('ignores %s and uses the role dashboard', async (callbackUrl) => {
      const proxy = await loadProxy();

      const res = await proxy(
        makeRequest(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, cookies),
      );

      expect(res.status).toBe(307);
      expect(new URL(res.headers.get('location')!).origin).toBe('https://app.test');
    });

    it('still honours a same-origin relative path', async () => {
      const proxy = await loadProxy();

      const res = await proxy(makeRequest('/auth/signin?callbackUrl=/reports', cookies));

      expect(res.headers.get('location')).toBe('https://app.test/reports');
    });

    /**
     * The WHATWG URL parser strips ASCII tab, LF and CR from anywhere in the
     * input before parsing, so a value that passes the `startsWith('/')` /
     * not-`//` / not-`/\` checks can still become protocol-relative once
     * `new URL` sees it: a horizontal tab followed by "/evil.com" parses as
     * "//evil.com". `safeCallbackUrl` has to reject every C0 control
     * character and DEL up front rather than enumerating the three the
     * parser strips.
     */
    it.each([
      ['/' + '\t' + '/evil.com'],
      ['/' + '\n' + '/evil.com'],
      ['/' + '\r' + '/evil.com'],
      ['/' + '\t' + '\\evil.com'],
      ['/ok '],
    ])('rejects control characters that the URL parser would strip: %j', (value) => {
      expect(safeCallbackUrl(value)).toBeNull();
    });

    it('redirects to the same-origin dashboard, not evil.com, for a tab-smuggled callbackUrl', async () => {
      const proxy = await loadProxy();

      const res = await proxy(makeRequest('/auth/signin?callbackUrl=/%09/evil.com', cookies));

      expect(res.status).toBe(307);
      expect(new URL(res.headers.get('location')!).origin).toBe('https://app.test');
    });
  });

  /**
   * The gates are cleared backend-side the moment enrollment or activation
   * finishes, and the session cookie does not change — so a cached reading
   * would keep bouncing the user back to the page they just completed. This is
   * the same staleness `cookieCache: false` was set on the backend to avoid.
   */
  describe('a session sitting on a gate is not served from cache', () => {
    const cookies = { [PROD_COOKIE]: 'tok' };

    it('revalidates instead of replaying the pre-enrollment reading', async () => {
      const proxy = await loadProxy();
      answer = {
        kind: 'session',
        data: { ...SESSION, session: { ...SESSION.session, enrollment_required: true } },
      };

      const gated = await proxy(makeRequest('/settings', cookies));
      expect(gated.headers.get('location')).toContain('/auth/mfa-setup');

      // Enrollment completes; the flag is gone but the cookie is identical.
      answer = { kind: 'session', data: SESSION };
      const after = await proxy(makeRequest('/settings', cookies));

      expect(getSessionCalls.length).toBe(2);
      expect(after.status).not.toBe(307);
    });

    it('still collapses the fan-out for an ungated session', async () => {
      const proxy = await loadProxy();
      answer = { kind: 'session', data: SESSION };

      await proxy(makeRequest('/settings', cookies));
      await proxy(makeRequest('/settings', cookies));

      expect(getSessionCalls.length).toBe(1);
    });
  });
});
