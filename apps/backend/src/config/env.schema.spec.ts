import { readFileSync } from 'fs';
import { join } from 'path';

import { apiSchema, validateEnv } from './env.schema';

/**
 * Guard rail, not a unit test.
 *
 * Asserts the rule rather than individual keys: every environment variable
 * `configuration.ts` reads must be described by `env.schema.ts`, so a missing
 * or malformed value is a boot failure rather than a runtime surprise.
 */

const CONFIG_PATH = join(__dirname, 'configuration.ts');

/**
 * Environment variables `configuration.ts` reads, by scanning for
 * `process.env.NAME`. Deliberately a source scan rather than an import: the
 * point is to catch a key someone adds to the config object without touching
 * the schema, and importing the module would only expose the resulting values.
 */
function envKeysReadByConfiguration(): string[] {
  const source = readFileSync(CONFIG_PATH, 'utf8');
  // Strip comments first so a key mentioned in prose (e.g. the note explaining
  // why DEPLOY_* was removed) is not mistaken for a real read.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const keys = new Set<string>();
  for (const match of code.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}

function keysDescribedBySchema(): string[] {
  return Object.keys(apiSchema.shape).sort();
}

describe('env schema covers everything configuration.ts reads', () => {
  it('has no unvalidated keys', () => {
    const read = envKeysReadByConfiguration();
    const validated = new Set(keysDescribedBySchema());
    const unvalidated = read.filter((k) => !validated.has(k));

    expect(unvalidated).toEqual([]);
  });

  it('reads at least the keys we expect, so a broken scan cannot pass vacuously', () => {
    // If the regex ever stops matching, the assertion above would pass against
    // an empty list. Anchor it on keys that must always be there.
    const read = envKeysReadByConfiguration();

    expect(read).toEqual(expect.arrayContaining(['DATABASE_URL', 'BETTER_AUTH_SECRET']));
  });
});

/**
 * A complete, valid environment. Cases override one key each, so a failure
 * names the key under test rather than the first missing one.
 */
const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mongodb://localhost:27017/app',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  BACKEND_URL: 'https://api.example.com',
  BETTER_AUTH_URL: 'https://api.example.com',
  FRONTEND_URL: 'https://example.com',
  RESET_TOKEN_SECRET: 'a'.repeat(43),
  BETTER_AUTH_SECRET: 'b'.repeat(43),
  ADMIN_SETUP_TOKEN: 'c'.repeat(43),
  MFA_KEK_B64: 'd'.repeat(44),
  AWS_S3_BUCKET_NAME: 'bucket',
  AWS_S3_BUCKET_REGION: 'us-east-1',
  MAIL_HOST: 'smtp.example.com',
  MAIL_USER: 'user',
  MAIL_PASS: 'pass',
  MAIL_FROM: 'no-reply@example.com',
};

describe('secret validation', () => {
  const validEnv = VALID_ENV;

  it('accepts a fully populated environment', () => {
    expect(apiSchema.safeParse(validEnv).success).toBe(true);
  });

  it.each(['BETTER_AUTH_SECRET', 'RESET_TOKEN_SECRET', 'ADMIN_SETUP_TOKEN'])(
    'rejects the shipped placeholder for %s',
    (key) => {
      const result = apiSchema.safeParse({ ...validEnv, [key]: 'replace-with-something' });

      expect(result.success).toBe(false);
    },
  );

  it.each(['BETTER_AUTH_SECRET', 'RESET_TOKEN_SECRET', 'ADMIN_SETUP_TOKEN'])(
    'rejects a too-short value for %s',
    (key) => {
      const result = apiSchema.safeParse({ ...validEnv, [key]: 'short' });

      expect(result.success).toBe(false);
    },
  );

  it('names the generator command so the fix does not need a search', () => {
    const result = apiSchema.safeParse({ ...validEnv, BETTER_AUTH_SECRET: 'short' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toContain('openssl rand -base64 32');
  });
});

describe('RESET_TOKEN_EXPIRATION_TIME', () => {
  const base = { ...VALID_ENV, NODE_ENV: 'test' };

  it('rejects a bare number, which jsonwebtoken would read as seconds', () => {
    // `jsonwebtoken` reads `86400000` as seconds — roughly 2.7 years.
    const result = apiSchema.safeParse({ ...base, RESET_TOKEN_EXPIRATION_TIME: '86400000' });

    expect(result.success).toBe(false);
  });

  it('accepts a duration string', () => {
    const result = apiSchema.safeParse({ ...base, RESET_TOKEN_EXPIRATION_TIME: '24h' });

    expect(result.success).toBe(true);
  });

  it('defaults to 24h, matching what the invite email promises', () => {
    const result = apiSchema.safeParse(base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.RESET_TOKEN_EXPIRATION_TIME).toBe('24h');
  });
});

describe('validateEnv writes defaults back to process.env', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function withEnv(env: Record<string, string>) {
    process.env = { ...env };
  }

  it('fills a key the operator left unset', () => {
    // `configuration.ts` reads process.env directly, so a schema default that
    // is not written back is decorative — validation passes while the config
    // object still hands the app `undefined`.
    withEnv({ ...VALID_ENV, NODE_ENV: 'test' });
    expect(process.env.JWT_EXPIRY_SECONDS).toBeUndefined();

    validateEnv();

    expect(process.env.JWT_EXPIRY_SECONDS).toBe('900');
    expect(process.env.RESET_TOKEN_EXPIRATION_TIME).toBe('24h');
  });

  it('never overwrites a value the operator did set', () => {
    withEnv({ ...VALID_ENV, NODE_ENV: 'test', JWT_EXPIRY_SECONDS: '300' });

    validateEnv();

    expect(process.env.JWT_EXPIRY_SECONDS).toBe('300');
  });

  it('caps JWT_EXPIRY_SECONDS so the sign-out blocklist TTL cannot be outlived', () => {
    const result = apiSchema.safeParse({ ...VALID_ENV, JWT_EXPIRY_SECONDS: '172800' });

    expect(result.success).toBe(false);
  });
});
