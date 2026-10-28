import type { Db } from 'mongodb';
import type { MailService } from 'src/modules/mail/mail.service';
import type { InvalidatedTokenModel } from 'src/schemas/auth/token.schema';
import type { RoleModel } from 'src/schemas/public/role.schema';
import type { UserModel } from 'src/schemas/public/user.schema';

/**
 * `rate-limit.spec.ts` proves the rate-limit primitives are right and
 * `rate-limit.integration.spec.ts` proves Better Auth behaves correctly when
 * they are supplied. This file covers the seam between them: that
 * `createBetterAuth` actually hands Better Auth the config. A correct
 * `rate-limit.ts` that nothing passes to `betterAuth()` reproduces the original
 * production bug exactly.
 */

const capturedOptions: any[] = [];

jest.mock('better-auth', () => ({
  betterAuth: (options: unknown) => {
    capturedOptions.push(options);
    return { handler: jest.fn(), api: {}, options };
  },
}));

jest.mock('better-auth/node', () => ({ toNodeHandler: () => jest.fn() }));

jest.mock('better-auth/adapters/mongodb', () => ({ mongodbAdapter: () => jest.fn() }));

import { createBetterAuth } from './better-auth';
import { DEFAULT_TRUSTED_PROXY_CIDRS, RATE_LIMIT_CUSTOM_RULES } from './rate-limit';
import { SESSION_EXPIRY_SECONDS } from './session.constants';

function buildWithRedis(redis: unknown, trustedProxyCidrs?: string) {
  capturedOptions.length = 0;
  createBetterAuth({
    db: {} as Db,
    redis: redis as never,
    userModel: {} as UserModel,
    roleModel: {} as RoleModel,
    invalidatedTokenModel: {} as InvalidatedTokenModel,
    frontendUrl: 'https://app.test',
    backendUrl: 'https://api.test',
    betterAuthSecret: 'secret-long-enough-for-better-auth',
    mailService: {} as MailService,
    trustedProxyCidrs,
  });
  return capturedOptions[0];
}

function build(trustedProxyCidrs?: string) {
  return buildWithRedis({ eval: jest.fn(), hgetall: jest.fn() }, trustedProxyCidrs);
}

function buildWithSignupGate(isSignUpEnabled: () => Promise<boolean>) {
  capturedOptions.length = 0;
  createBetterAuth({
    db: {} as Db,
    redis: { eval: jest.fn(), hgetall: jest.fn() } as never,
    userModel: {} as UserModel,
    roleModel: {} as RoleModel,
    invalidatedTokenModel: {} as InvalidatedTokenModel,
    frontendUrl: 'https://app.test',
    backendUrl: 'https://api.test',
    betterAuthSecret: 'secret-long-enough-for-better-auth',
    mailService: {} as MailService,
    isSignUpEnabled,
  });
  return capturedOptions[0];
}

describe('createBetterAuth — rate limiting wiring', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('passes trusted proxies through to advanced.ipAddress', () => {
    const options = build('172.16.0.0/12,10.9.8.7');
    expect(options.advanced.ipAddress.trustedProxies).toEqual(['172.16.0.0/12', '10.9.8.7']);
  });

  it('falls back to the documented defaults when the env var is unset', () => {
    const options = build(undefined);
    expect(options.advanced.ipAddress.trustedProxies).toEqual([...DEFAULT_TRUSTED_PROXY_CIDRS]);
  });

  it('logs the effective proxy list so a misconfiguration is visible at boot', () => {
    build('172.16.0.0/12');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('172.16.0.0/12'));
  });

  it('keeps the generateId override alongside the new ipAddress config', () => {
    const options = build();
    expect(options.advanced.database.generateId).toBe(false);
  });

  // This app used to be wired with an in-process Map that re-implemented Better
  // Auth's own `memory` backend, while this file still called it "the atomic
  // storage". Counters were per Node process, so two containers behind nginx
  // gave every client 2x each limit and a deploy reset them all. RedisModule is
  // @Global here, so the same Redis storage the Drizzle app uses is available.
  it('backs the limiter with the shared Redis client, not process memory', async () => {
    const redis = { eval: jest.fn().mockResolvedValue(1), hgetall: jest.fn() };
    const options = buildWithRedis(redis);

    await options.rateLimit.customStorage.consume('203.0.113.10|/get-session', {
      window: 60,
      max: 10,
    });

    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('installs the per-client custom rules and the atomic storage', () => {
    const options = build();
    expect(options.rateLimit.customRules).toBe(RATE_LIMIT_CUSTOM_RULES);
    expect(typeof options.rateLimit.customStorage.consume).toBe('function');
  });

  // Leaving `enabled` unset keeps Better Auth's production-only default, so
  // development stays unthrottled.
  it('does not force the limiter on outside production', () => {
    const options = build();
    expect(options.rateLimit.enabled).toBeUndefined();
  });

  it('pins the session lifetime the MFA session-state TTL is sized against', () => {
    const options = build();
    expect(options.session.expiresIn).toBe(SESSION_EXPIRY_SECONDS);
  });
});

/**
 * The route hook only sees `/sign-up/email`. A Google sign-in that creates a
 * new user arrives through the OAuth callback and never passes it, so with the
 * route hook alone a closed instance still accepted new social accounts.
 * `databaseHooks.user.create.before` is the shared choke point that closes it.
 *
 * Gating there is only safe because nothing in this app creates a user through
 * Better Auth except self-registration — admin provisioning writes the row
 * directly and never reaches the hook.
 */
describe('createBetterAuth — signup gate wiring', () => {
  const closed = () => buildWithSignupGate(async () => false);
  const open = () => buildWithSignupGate(async () => true);

  const FORBIDDEN = { message: 'SIGNUP_DISABLED' };
  const socialUser = { email: 'new@example.com', name: 'New Person' };

  it('refuses /sign-up/email when signup is disabled', async () => {
    await expect(closed().hooks.before({ path: '/sign-up/email' })).rejects.toMatchObject({
      body: FORBIDDEN,
    });
  });

  it('lets /sign-up/email through when signup is enabled', async () => {
    await expect(open().hooks.before({ path: '/sign-up/email' })).resolves.toBeUndefined();
  });

  it('leaves sign-in alone, so existing users can still authenticate', async () => {
    await expect(closed().hooks.before({ path: '/sign-in/email' })).resolves.toBeUndefined();
  });

  it('refuses social sign-up, which never passes the route hook', async () => {
    await expect(closed().databaseHooks.user.create.before(socialUser)).rejects.toMatchObject({
      body: FORBIDDEN,
    });
  });

  it('lets user creation past the gate when signup is enabled', async () => {
    // The hook goes on to resolve the default role, which this unit test has no
    // database for — so the assertion is that it got *past* the gate, not that
    // it completed. Anything but SIGNUP_DISABLED means the gate opened.
    await expect(open().databaseHooks.user.create.before(socialUser)).rejects.not.toMatchObject({
      body: FORBIDDEN,
    });
  });

  it('is open when no gate is supplied, preserving always-open behaviour', async () => {
    await expect(build().hooks.before({ path: '/sign-up/email' })).resolves.toBeUndefined();
  });
});
