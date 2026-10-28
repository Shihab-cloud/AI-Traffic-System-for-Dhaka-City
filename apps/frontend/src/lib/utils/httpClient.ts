import { APIUrl } from '@/lib/constants/url.config';
import type { MfaStepUpScope } from '@/lib/enums/mfa.enum';
import { stepUpController, StepUpCancelled } from '@/lib/utils/step-up-controller';
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import qs from 'qs';

axios.defaults.paramsSerializer = (params) => {
  return qs.stringify(params, {
    arrayFormat: 'repeat',
  });
};

// In-memory JWT cache (client-side only)
let cachedJwt: string | null = null;

/**
 * The mint currently in flight, if any.
 *
 * Without this, every request that starts before the first mint resolves sees
 * an empty `cachedJwt` and starts its own: a page mounting eight parallel
 * requests made eight `/token` calls. That is the endpoint whose per-address
 * limit this client is trying to stay under, and a whole office shares one
 * address — so the fan-out is exactly what pushes it over.
 */
let inFlightMint: Promise<TokenMint> | null = null;

/**
 * When a mint last failed transiently. Suppresses re-minting for
 * {@link MINT_COOLDOWN_MS} afterwards.
 *
 * `cachedJwt` cannot express "we tried and it failed" — storing `null` in it is
 * indistinguishable from "never minted", so each following request tried again
 * and the client hammered a throttled `/token` instead of backing off, keeping
 * the window permanently full. Requests during the cooldown go out without a
 * bearer token: the session cookie still travels (`withCredentials`), and a
 * genuine 401 is handled by the response interceptor below.
 */
let mintFailedAt = 0;
const MINT_COOLDOWN_MS = 5_000;

/**
 * Drop everything the next request could reuse to prove the old session.
 *
 * `inFlightMint` matters as much as the token: a mint started *before* the 401
 * resolves to the same stale JWT, so joining it would retry with exactly the
 * credential the server just rejected.
 *
 * `mintFailedAt` is deliberately *not* cleared. It is the back-off that keeps
 * a throttled `/token` from being hammered, and every 401 from the API would
 * reset it — restoring one mint per failing request, which is the
 * amplification the cooldown exists to stop.
 */
function clearJwtCache() {
  cachedJwt = null;
  inFlightMint = null;
}

/**
 * Why a mint can fail without meaning "signed out".
 *
 * `/token` is rate limited on the backend. A 429 — or a 5xx, or a dropped
 * connection — says nothing about whether the session is valid, so treating it
 * as a logout bounces a signed-in user to the sign-in page over a transient
 * backend condition. Only an authoritative 401/403 means the session is gone.
 */
function isAuthoritativeAuthFailure(status?: number): boolean {
  return status === 401 || status === 403;
}

interface TokenMint {
  token: string | null;
  /** The mint failed for a reason that is not a session verdict. */
  transientFailure: boolean;
}

async function mintAccessToken(): Promise<TokenMint> {
  const { authClient } = await import('@/lib/auth-client');
  try {
    const { data, error } = await authClient.token();
    if (error) {
      return { token: null, transientFailure: !isAuthoritativeAuthFailure(error.status) };
    }
    return { token: data?.token ?? null, transientFailure: false };
  } catch {
    // Network-level failure — never a session verdict.
    return { token: null, transientFailure: true };
  }
}

async function getAccessToken(): Promise<TokenMint> {
  // httpClient is client-only. For server-side, use server-auth.ts directly.
  if (typeof window === 'undefined') {
    return { token: null, transientFailure: false };
  }

  if (cachedJwt) {
    return { token: cachedJwt, transientFailure: false };
  }

  // Back off after a transient failure rather than re-minting per request.
  if (mintFailedAt && Date.now() - mintFailedAt < MINT_COOLDOWN_MS) {
    return { token: null, transientFailure: true };
  }

  // Single-flight: concurrent callers await the same mint.
  inFlightMint ??= mintAccessToken()
    .then((minted) => {
      cachedJwt = minted.token;
      mintFailedAt = minted.transientFailure ? Date.now() : 0;
      return minted;
    })
    .finally(() => {
      inFlightMint = null;
    });

  return inFlightMint;
}

/**
 * 401 codes that mean "considered and refused", not "your credentials are
 * stale". Retrying one re-sends the rejected input and spends another of
 * whatever budget the endpoint enforces.
 *
 * `step_up_required` is absent deliberately — that one is retryable, and has
 * its own branch above.
 */
const APPLICATION_VERDICTS = new Set([
  'mfa_verification_failed',
  'invalid_attempt_token',
  'invalid_backup_code',
]);

function isApplicationVerdict(code: string | undefined): boolean {
  return !!code && APPLICATION_VERDICTS.has(code);
}

const httpClient = axios.create({
  baseURL: APIUrl.base + '/api',
  withCredentials: true,
});

export const httpClientWithoutToken = axios.create({
  baseURL: APIUrl.base + '/api',
  withCredentials: true,
});

// Request interceptor: attach JWT
httpClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const { token } = await getAccessToken();

    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  },
);

// Response interceptor: refresh token on 401, redirect if refresh fails.
// Special-cases the MFA step-up flow: when the server responds 401 with
// `error: 'step_up_required'`, we pop the StepUpDialog (via stepUpController),
// attach the issued token to the original request, and retry.
httpClient.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const originalRequest = err.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
      _stepUpRetried?: boolean;
    };

    const data = err.response?.data as { error?: string; scope?: MfaStepUpScope } | undefined;

    // Step-up branch: only on 401 + matching error code, only once per request.
    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      data?.error === 'step_up_required' &&
      data?.scope &&
      !originalRequest._stepUpRetried
    ) {
      originalRequest._stepUpRetried = true;
      try {
        const stepUpToken = await stepUpController.requireStepUp(data.scope);
        originalRequest.headers['Authorization-Step-Up'] = stepUpToken;
        return httpClient(originalRequest);
      } catch (e) {
        // User cancelled or no handler registered → propagate the original 401.
        if (!(e instanceof StepUpCancelled)) {
          // Surface unexpected controller errors so callers can react.
          return Promise.reject(e);
        }
        return Promise.reject(err);
      }
    }

    // Generic 401 branch: refresh JWT once. Skipped when the body carries an
    // application verdict — a wrong MFA code is not a stale token, and
    // retrying it spends a second challenge attempt and a second rate-limit
    // slot.
    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !isApplicationVerdict(data?.error) &&
      !originalRequest._retried
    ) {
      originalRequest._retried = true;
      clearJwtCache();

      const { token, transientFailure } = await getAccessToken();
      if (token) {
        originalRequest.headers['Authorization'] = `Bearer ${token}`;
        return httpClient(originalRequest);
      }

      // Fail open. If we could not mint a token because `/token` was throttled
      // or the backend blipped, surface the error to the caller and leave the
      // user on the page — the next request will retry. Redirecting here is
      // what turned a rate-limited JWT endpoint into a visible logout.
      if (!transientFailure) {
        window.location.href = '/auth/signin';
      }
    }

    return Promise.reject(err);
  },
);

export default httpClient;
