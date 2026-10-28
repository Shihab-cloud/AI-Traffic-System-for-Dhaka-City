import { additionalFieldsPlugin } from '@/lib/auth-fields';
import { createAuthClient } from 'better-auth/client';
import { NextRequest, NextResponse } from 'next/server';
import { RouteUrls, defaultRedirectForPermissions } from './lib/routes/route.config';
import { TypedSessionData } from './lib/types/auth.types';
import { safeCallbackUrl } from './lib/utils/url.util';

/**
 * Re-exported so `proxy.test.ts` (and any other server-side caller) can keep
 * importing it from here. The implementation lives in `lib/utils/url.util.ts`
 * because client components under `src/app` need it too, and this file
 * cannot be imported across the `'use client'` boundary.
 */
export { safeCallbackUrl };

/**
 * Better Auth's session cookie. In production it carries the `__Secure-` prefix
 * (`createCookieGetter` adds it whenever the base URL is https or NODE_ENV is
 * production), and a large session is split into `-0`, `-1`, ... chunks. Both
 * variants have to be recognised — matching only the bare name would mean the
 * proxy sees no cookie at all in production.
 *
 * `better-auth` is the default `advanced.cookiePrefix`; keep this in sync if the
 * backend ever sets a custom one.
 */
const SESSION_COOKIE_NAME = 'better-auth.session_token';

function sessionCookies(request: NextRequest) {
  return request.cookies
    .getAll()
    .filter(
      (c) =>
        c.name === SESSION_COOKIE_NAME ||
        c.name === `__Secure-${SESSION_COOKIE_NAME}` ||
        c.name.startsWith(`${SESSION_COOKIE_NAME}-`) ||
        c.name.startsWith(`__Secure-${SESSION_COOKIE_NAME}-`),
    );
}

const publicPaths = [
  RouteUrls.auth.signin,
  RouteUrls.auth.signup,
  RouteUrls.auth.forgotPassword,
  RouteUrls.auth.resetPassword,
  RouteUrls.auth.acceptInvite,
  RouteUrls.auth.accountBanned,
  RouteUrls.auth.mfaChallenge,
  RouteUrls.auth.mfaSetup,
  RouteUrls.auth.activate,
  RouteUrls.unauthorized,
  RouteUrls.notFound,
  RouteUrls.faq,
  // The sign-up form links to both, so they must open before an account exists.
  RouteUrls.terms,
  RouteUrls.privacyPolicy,
];

/**
 * Paths a signed-in user has no business on — they are sent to their dashboard (or back to
 * `callbackUrl`).
 *
 * Deliberately narrower than `publicPaths`: `mfa-setup` and `activate` exist *for* signed-in users
 * mid-onboarding, and `/faq`, `/unauthorized`, `/not-found` and the legal pages are readable by
 * anyone. Driving both decisions off one list sent a signed-in user who followed the FAQ link on
 * the not-found page to their dashboard instead.
 */
const GUEST_ONLY_PATHS = [
  RouteUrls.auth.signin,
  RouteUrls.auth.signup,
  RouteUrls.auth.forgotPassword,
  RouteUrls.auth.resetPassword,
  RouteUrls.auth.acceptInvite,
  RouteUrls.auth.accountBanned,
  RouteUrls.auth.mfaChallenge,
];

/** Matches on path boundaries, so `/faq` never claims a sibling such as `/faq-management`. */
function matchesPath(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

interface ProxySession {
  session: TypedSessionData | null;
  /**
   * The backend could not answer (429, 5xx, network error) — `session` is null
   * because we do not *know*, not because the user is signed out. Callers must
   * render the page instead of bouncing to signin: a rate-limited or briefly
   * unavailable backend must never look like a logout.
   */
  unavailable: boolean;
  /**
   * `Set-Cookie` headers the backend issued while answering. Better Auth
   * refreshes the session cookie once per `updateAge` and returns the new
   * cookie on the `get-session` response. Because that call is made here,
   * server-side, the header has to be replayed onto our own response or the
   * browser never sees it — the server-side expiry is extended in Redis while
   * the browser cookie keeps its original 7-day `maxAge`, and every user is
   * hard-signed-out exactly 7 days after signing in regardless of activity.
   */
  setCookies: string[];
}

const UNAVAILABLE: ProxySession = { session: null, unavailable: true, setCookies: [] };
const SIGNED_OUT: ProxySession = { session: null, unavailable: false, setCookies: [] };

/**
 * The onboarding gates the proxy enforces, plus the role landing page.
 *
 * Kept as its own shape so the gates can be evaluated from a live session *or*
 * from the last known reading when the backend cannot answer — see
 * {@link recallGates}.
 */
interface SessionGates {
  activationRequired: boolean;
  enrollmentRequired: boolean;
  roleDashboard: string;
}

function gatesOf(session: TypedSessionData): SessionGates {
  return {
    activationRequired: Boolean(session.session.activation_required),
    enrollmentRequired: Boolean(session.session.enrollment_required),
    roleDashboard: defaultRedirectForPermissions(session.user.role?.permissions),
  };
}

function hasPendingGate(gates: SessionGates): boolean {
  return gates.activationRequired || gates.enrollmentRequired;
}

/**
 * A single navigation costs several proxy invocations — the document request,
 * its RSC counterpart, and every `<Link>` prefetch — each of which would
 * otherwise be its own `get-session` round trip, multiplied by open tabs.
 *
 * Entries hold the in-flight promise rather than its result, so concurrent
 * invocations for the same session share one backend call, and a resolved entry
 * keeps serving for {@link SESSION_CACHE_MS}. The window is deliberately short:
 * session state mutated elsewhere (MFA enrollment, activation) must surface
 * quickly, which is the same reason Better Auth's own 5-minute `cookieCache`
 * is disabled on the backend.
 *
 * Even 3s is too long for a session that is *sitting on* a gate, though: the
 * flags are cleared backend-side the moment enrollment or activation finishes,
 * the session cookie does not change, so a cached copy would keep redirecting
 * the user back to the page they just completed. {@link readCachedSession}
 * therefore refuses to serve a cached reading whose gates are still pending —
 * a state that is rare and short-lived, so the fan-out saving is untouched for
 * everyone else.
 */
const SESSION_CACHE_MS = 3_000;
const SESSION_CACHE_MAX_ENTRIES = 5_000;
const sessionCache = new Map<string, { at: number; promise: Promise<ProxySession> }>();

/**
 * Last *successful* gate reading per session cookie.
 *
 * When `get-session` cannot answer, the proxy has no session object and so
 * cannot evaluate the activation / enrollment gates at all. Rendering the page
 * anyway is what a fail-open used to mean here, and it let an admin-provisioned
 * user on a temp password — or a mandatory-MFA user with no factor enrolled —
 * walk into protected routes on any backend 429 or restart.
 *
 * Remembering the last reading closes that: the fail-open stays "do not treat
 * unknown as signed out" while the gates continue to be enforced from what we
 * last saw. Longer-lived than {@link SESSION_CACHE_MS} because its purpose is
 * to survive an outage, and safe to be stale in that direction — a stale gate
 * sends the user to a page they can leave under their own steam, whereas
 * missing one lets them past a mandatory step entirely.
 */
const GATE_MEMO_MS = 30 * 60 * 1000;
const GATE_MEMO_MAX_ENTRIES = 5_000;
const gateMemo = new Map<string, { at: number; gates: SessionGates }>();

function prune<V extends { at: number }>(
  map: Map<string, V>,
  now: number,
  ttl: number,
  max: number,
) {
  for (const [key, entry] of map) {
    if (now - entry.at >= ttl) map.delete(key);
  }
  if (map.size <= max) return;
  let overflow = map.size - max;
  for (const key of map.keys()) {
    map.delete(key);
    if (--overflow <= 0) break;
  }
}

function rememberGates(cacheKey: string, gates: SessionGates, now: number) {
  prune(gateMemo, now, GATE_MEMO_MS, GATE_MEMO_MAX_ENTRIES);
  gateMemo.set(cacheKey, { at: now, gates });
}

function recallGates(cacheKey: string, now: number): SessionGates | null {
  const entry = gateMemo.get(cacheKey);
  if (!entry) return null;
  if (now - entry.at >= GATE_MEMO_MS) {
    gateMemo.delete(cacheKey);
    return null;
  }
  return entry.gates;
}

async function fetchProxySession(request: NextRequest): Promise<ProxySession> {
  const client = createAuthClient({
    baseURL: request.nextUrl.origin,
    basePath: '/api/auth',
    plugins: [additionalFieldsPlugin],
  });

  const setCookies: string[] = [];

  try {
    const { data, error } = await client.getSession({
      fetchOptions: {
        headers: request.headers,
        onResponse: ({ response }) => {
          // `getSetCookie` is the only way to read multiple Set-Cookie headers;
          // `headers.get('set-cookie')` folds them into one string.
          setCookies.push(...response.headers.getSetCookie());
        },
      },
      // * disableCookieCache to force backend to revalidate via Redis
      query: { disableCookieCache: true },
    });

    if (error) {
      // 401/403 is an authoritative "not signed in". Anything else — 429 from
      // the rate limiter, a 5xx, a gateway hiccup — is a backend problem, not
      // a session verdict.
      const authoritative = error.status === 401 || error.status === 403;
      if (!authoritative) {
        console.warn(
          `[proxy] get-session failed with ${error.status ?? 'network error'} — rendering the ` +
            'page rather than signing the user out.',
        );
        return { ...UNAVAILABLE, setCookies };
      }
      return { ...SIGNED_OUT, setCookies };
    }

    return { session: (data as TypedSessionData) ?? null, unavailable: false, setCookies };
  } catch (e) {
    // Thrown rather than returned: DNS failure, socket reset, abort.
    console.warn(
      '[proxy] get-session threw — rendering the page rather than signing the user out.',
      e,
    );
    return { ...UNAVAILABLE, setCookies };
  }
}

function refetchSession(
  request: NextRequest,
  cacheKey: string,
  now: number,
): Promise<ProxySession> {
  const promise = fetchProxySession(request);
  sessionCache.set(cacheKey, { at: now, promise });
  // A rejected promise must not be cached, or one blip poisons the entry for
  // its whole window. `fetchProxySession` catches, so this is belt-and-braces.
  promise.catch(() => sessionCache.delete(cacheKey));

  return promise.then((result) => {
    if (result.session) rememberGates(cacheKey, gatesOf(result.session), now);
    return result;
  });
}

/**
 * Deliberately not `async`: the cache lookup and the insert that follows it
 * must land in the same tick. An `await` before `sessionCache.set` lets every
 * concurrent invocation for one navigation see an empty cache and start its own
 * `get-session`, which is the fan-out this cache exists to collapse.
 */
function getProxySession(request: NextRequest, cacheKey: string): Promise<ProxySession> {
  const now = Date.now();
  prune(sessionCache, now, SESSION_CACHE_MS, SESSION_CACHE_MAX_ENTRIES);

  const cached = sessionCache.get(cacheKey);
  if (cached && now - cached.at < SESSION_CACHE_MS) {
    return cached.promise.then((result) => {
      // A reading sitting on a pending gate is not safe to reuse — see the note
      // on SESSION_CACHE_MS. Rare and short-lived, so the fan-out saving is
      // untouched for everyone else.
      if (result.session && hasPendingGate(gatesOf(result.session))) {
        return refetchSession(request, cacheKey, Date.now());
      }
      return result;
    });
  }

  return refetchSession(request, cacheKey, now);
}

/** Replays backend `Set-Cookie` headers onto our own response. */
function withSessionCookies(response: NextResponse, setCookies: string[]): NextResponse {
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/**
 * Applies the onboarding gates. Shared by the live-session path and the
 * backend-unavailable path so the two cannot drift — the drift is what let a
 * 429 bypass activation and MFA enrollment.
 */
function gateRedirect(pathname: string, gates: SessionGates, request: NextRequest): URL | null {
  // * Redirect Admin-provisioned users carrying a temp password
  if (gates.activationRequired && !pathname.startsWith(RouteUrls.auth.activate)) {
    return new URL(RouteUrls.auth.activate, request.url);
  }

  // * Redirect Mandatory-MFA users in the grace window without a factor enrolled
  if (gates.enrollmentRequired && !pathname.startsWith(RouteUrls.auth.mfaSetup)) {
    const setupUrl = new URL(RouteUrls.auth.mfaSetup, request.url);
    if (pathname !== '/' && !pathname.startsWith('/auth')) {
      setupUrl.searchParams.set('callbackUrl', pathname);
    }
    return setupUrl;
  }

  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    return new URL(gates.roleDashboard, request.url);
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // * Skip auth proxy routes — let Next.js rewrites handle them
  if (pathname.startsWith('/api/auth')) return NextResponse.next();

  // * Landing preview pages are public marketing routes — always accessible.
  // * Remove this line if you remove the src/landing system (see its README).
  if (pathname.startsWith('/landing')) return NextResponse.next();

  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));

  const cookies = sessionCookies(request);
  // No cookie, no session — and nothing worth caching or asking the backend
  // about. This also keeps signed-out traffic off the shared cache.
  if (cookies.length === 0) {
    if (!isPublicPath && pathname !== '/') {
      const signInUrl = new URL(RouteUrls.auth.signin, request.url);
      signInUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }

  const cacheKey = cookies.map((c) => `${c.name}=${c.value}`).join(';');
  const { session, unavailable, setCookies } = await getProxySession(request, cacheKey);
  const next = () => withSessionCookies(NextResponse.next(), setCookies);
  const redirect = (url: URL) => withSessionCookies(NextResponse.redirect(url), setCookies);

  // * The backend could not tell us whether this session is valid. Do not sign
  // * the user out — but do not drop the gates either: keep enforcing them from
  // * the last reading we have, so a 429 cannot be used to skip activation or
  // * mandatory MFA enrollment. With no reading at all there is nothing to
  // * enforce, so render and let the API's own auth decide.
  if (unavailable) {
    const remembered = recallGates(cacheKey, Date.now());
    if (remembered) {
      const target = gateRedirect(pathname, remembered, request);
      if (target) return redirect(target);
    }
    return next();
  }

  // * Redirect to signin for protected routes
  if (!session) {
    if (!isPublicPath && pathname !== '/') {
      const signInUrl = new URL(RouteUrls.auth.signin, request.url);
      signInUrl.searchParams.set('callbackUrl', pathname);
      const response = redirect(signInUrl);
      // Clear every variant we found, not just the unprefixed name — otherwise
      // a production `__Secure-` cookie survives the redirect and the user
      // bounces through signin again on the next navigation.
      for (const cookie of cookies) response.cookies.delete(cookie.name);
      return response;
    }
    return next();
  }

  const gates = gatesOf(session);
  const target = gateRedirect(pathname, gates, request);
  if (target) return redirect(target);

  // * Redirect away from signed-out-only pages (respect callbackUrl if present).
  if (GUEST_ONLY_PATHS.some((base) => matchesPath(pathname, base))) {
    const callbackUrl = safeCallbackUrl(request.nextUrl.searchParams.get('callbackUrl'));
    const destination = callbackUrl || gates.roleDashboard;
    return redirect(new URL(destination, request.url));
  }

  return next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
