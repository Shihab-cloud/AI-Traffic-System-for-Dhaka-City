import type { AxiosError, AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/token` is rate limited on the backend. Before the fix, a 429 there made
 * `getAccessToken()` return null and the response interceptor navigated to
 * `/auth/signin` — a throttled JWT endpoint presenting as a logout. Only an
 * authoritative 401/403 may sign the user out.
 */

type TokenAnswer =
  { kind: 'ok'; token: string } | { kind: 'error'; status: number } | { kind: 'throw' };

let tokenAnswer: TokenAnswer = { kind: 'ok', token: 'jwt-1' };
let tokenCalls = 0;

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    token: async () => {
      tokenCalls++;
      if (tokenAnswer.kind === 'throw') throw new Error('network down');
      if (tokenAnswer.kind === 'error') {
        return { data: null, error: { status: tokenAnswer.status, statusText: 'err' } };
      }
      return { data: { token: tokenAnswer.token }, error: null };
    },
  },
}));

// Not exercised here, but imported by httpClient.
vi.mock('@/lib/utils/step-up-controller', () => ({
  stepUpController: { requireStepUp: vi.fn() },
  StepUpCancelled: class StepUpCancelled extends Error {},
}));

const location = { href: '/dashboard' };

async function loadClient() {
  vi.resetModules();
  tokenCalls = 0;
  location.href = '/dashboard';
  // httpClient guards its browser-only paths with `typeof window === 'undefined'`.
  (globalThis as unknown as { window: unknown }).window = { location };
  return (await import('./httpClient')).default;
}

/**
 * Replaces the transport so every request fails the way a JWT-less call to the
 * API does, letting the real interceptor chain run.
 */
function alwaysUnauthorized(client: AxiosInstance) {
  const seen: (string | undefined)[] = [];
  client.defaults.adapter = async (config) => {
    seen.push(config.headers?.Authorization as string | undefined);
    const error = new Error('Request failed with status code 401') as AxiosError;
    error.isAxiosError = true;
    error.config = config as never;
    error.response = {
      status: 401,
      statusText: 'Unauthorized',
      data: {},
      headers: {},
      config: config as never,
    };
    throw error;
  };
  return seen;
}

describe('httpClient token handling', () => {
  beforeEach(() => {
    tokenAnswer = { kind: 'ok', token: 'jwt-1' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('attaches a freshly minted token', async () => {
    const client = await loadClient();
    const seen = alwaysUnauthorized(client);

    await expect(client.get('/user')).rejects.toBeDefined();

    expect(seen[0]).toBe('Bearer jwt-1');
  });

  describe('when /token is throttled', () => {
    it('does not navigate to signin', async () => {
      const client = await loadClient();
      alwaysUnauthorized(client);
      tokenAnswer = { kind: 'error', status: 429 };

      await expect(client.get('/user')).rejects.toBeDefined();

      // The whole point: a rate-limited JWT endpoint must surface an error to
      // the caller and leave the user on the page.
      expect(location.href).toBe('/dashboard');
    });

    it('rejects so the caller can show an error and retry', async () => {
      const client = await loadClient();
      alwaysUnauthorized(client);
      tokenAnswer = { kind: 'error', status: 429 };

      await expect(client.get('/user')).rejects.toMatchObject({
        response: { status: 401 },
      });
    });

    it('does the same for a 5xx or a network failure', async () => {
      for (const answer of [{ kind: 'error', status: 503 } as const, { kind: 'throw' } as const]) {
        const client = await loadClient();
        alwaysUnauthorized(client);
        tokenAnswer = answer;

        await expect(client.get('/user')).rejects.toBeDefined();
        expect(location.href).toBe('/dashboard');
      }
    });
  });

  describe('when the session is genuinely gone', () => {
    it('navigates to signin on an authoritative 401 from /token', async () => {
      const client = await loadClient();
      alwaysUnauthorized(client);
      tokenAnswer = { kind: 'error', status: 401 };

      await expect(client.get('/user')).rejects.toBeDefined();

      expect(location.href).toBe('/auth/signin');
    });

    it('navigates to signin on a 403 too', async () => {
      const client = await loadClient();
      alwaysUnauthorized(client);
      tokenAnswer = { kind: 'error', status: 403 };

      await expect(client.get('/user')).rejects.toBeDefined();

      expect(location.href).toBe('/auth/signin');
    });
  });

  it('retries the original request once with a re-minted token', async () => {
    const client = await loadClient();
    const seen: (string | undefined)[] = [];
    let call = 0;

    client.defaults.adapter = async (config) => {
      seen.push(config.headers?.Authorization as string | undefined);
      call++;
      if (call === 1) {
        const error = new Error('401') as AxiosError;
        error.isAxiosError = true;
        error.config = config as never;
        error.response = {
          status: 401,
          statusText: 'Unauthorized',
          data: {},
          headers: {},
          config: config as never,
        };
        throw error;
      }
      return { status: 200, statusText: 'OK', data: { ok: true }, headers: {}, config };
    };

    const res = await client.get('/user');

    expect(res.data).toEqual({ ok: true });
    expect(seen).toEqual(['Bearer jwt-1', 'Bearer jwt-1']);
    // Cached, cleared on 401, minted again — exactly twice.
    expect(tokenCalls).toBe(2);
  });

  /**
   * `/token` is the endpoint whose per-address limit this client is trying to
   * stay under, and a whole NAT'd office shares one address — so the client's
   * own fan-out is what pushes it over.
   */
  describe('not amplifying the /token limit', () => {
    // Every request that starts before the first mint resolves used to see an
    // empty cache and start its own: a page mounting eight parallel requests
    // made eight `/token` calls.
    it('mints once for a burst of concurrent requests', async () => {
      const client = await loadClient();
      client.defaults.adapter = async (config) => ({
        status: 200,
        statusText: 'OK',
        data: { ok: true },
        headers: {},
        config,
      });

      await Promise.all(Array.from({ length: 8 }, () => client.get('/user')));

      expect(tokenCalls).toBe(1);
    });

    // `cachedJwt = null` cannot express "we tried and it failed", so each
    // following request re-minted and the client hammered a throttled endpoint
    // instead of backing off — the window never cleared.
    it('backs off instead of re-minting while /token is throttled', async () => {
      const client = await loadClient();
      alwaysUnauthorized(client);
      tokenAnswer = { kind: 'error', status: 429 };

      await expect(client.get('/user')).rejects.toBeDefined();
      const afterFirst = tokenCalls;

      for (let i = 0; i < 5; i++) {
        await expect(client.get('/user')).rejects.toBeDefined();
      }

      // No further mints while the cooldown holds, and still no logout.
      expect(tokenCalls).toBe(afterFirst);
      expect(location.href).toBe('/dashboard');
    });
  });
});
