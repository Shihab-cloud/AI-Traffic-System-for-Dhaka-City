import { z } from 'zod';
import { MAX_JWT_LIFETIME_SECONDS } from '../shared/constants/jwt.constants';

const numberFromString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v : Number(v)))
  .pipe(z.number().int().positive());

/**
 * `"true"` / `"false"` from the environment, as an actual boolean.
 *
 * Env values are always strings and `"false"` is truthy, so these must be
 * parsed rather than read. Anything other than a recognised literal is
 * rejected, so a typo fails at boot instead of quietly meaning `false`.
 */
const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

/**
 * A secret that must actually be secret.
 *
 * Rejects both the too-short and the never-changed cases: `.env.example` ships
 * `replace-with-<name>` placeholders, and a value published in the template
 * repo is no more secret than a two-character one. The message names the
 * generator so the fix is one paste, not a search.
 */
const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters — generate one with: openssl rand -base64 32`)
    .refine(
      (v) => !v.startsWith('replace-with'),
      `${name} is still the placeholder from .env.example — generate one with: openssl rand -base64 32`,
    );

export const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_VERSION: z.string().default('local'),
  APP_NAME: z.string().default('Advance'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: numberFromString,
});

export const apiSchema = baseSchema.extend({
  PORT: numberFromString.default(5001),
  BACKEND_URL: z.url(),

  // Session cookies and reset tokens are signed with these, so a placeholder
  // value is equivalent to no signature at all. `setup.mjs` generates real
  // ones; the floor here catches a `.env` assembled some other way.
  RESET_TOKEN_SECRET: secret('RESET_TOKEN_SECRET'),
  BETTER_AUTH_SECRET: secret('BETTER_AUTH_SECRET'),
  BETTER_AUTH_URL: z.url(),
  FRONTEND_URL: z.url(),

  // Comma-separated IPs/CIDRs of the reverse proxies in front of this service.
  // Optional — defaults to loopback + Docker's bridge pools. Rate limiting
  // depends on it to resolve a client IP from `x-forwarded-for`; see
  // `src/lib/auth/rate-limit.ts`.
  TRUSTED_PROXY_CIDRS: z.string().optional(),

  AWS_S3_BUCKET_NAME: z.string().min(1),
  AWS_S3_BUCKET_REGION: z.string().min(1),
  // S3-compatible endpoint + static keys (local SeaweedFS). Optional: unset = AWS S3 + default credential chain.
  AWS_S3_ENDPOINT: z.string().optional(),
  AWS_S3_ACCESS_KEY: z.string().optional(),
  AWS_S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Traffic enforcement: vision service, VLM, payments
  VISION_URL: z.url().default('http://127.0.0.1:8601'),
  // Where browsers reach the vision service (live view, uploads); defaults to VISION_URL.
  VISION_PUBLIC_URL: z.url().optional(),
  VISION_KEY: secret('VISION_KEY'),
  // local = vision-language model run by the vision service on this computer (no API); anthropic = Claude (needs
  // ANTHROPIC_API_KEY); rules = a summary built from the recorded data only (clearly labelled as such).
  VLM_PROVIDER: z.enum(['local', 'anthropic', 'rules']).default('local'),
  VLM_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  CURRENCY: z.string().default('BDT'),

  // Optional — Google login is enabled only when both are present (matches mongoose).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  MAIL_HOST: z.string().min(1),
  MAIL_USER: z.string().min(1),
  MAIL_PASS: z.string().min(1),
  MAIL_FROM: z.string().min(1),

  MFA_KEK_B64: z.string().min(40, 'MFA_KEK_B64 must be 32-byte base64 (~44 chars)'),

  // Gates the `@Public()` bootstrap-admin route. Boot-required rather than
  // optional so the route can never be live with an unset or placeholder
  // token; `setup.mjs` generates one for scaffolded projects.
  ADMIN_SETUP_TOKEN: secret('ADMIN_SETUP_TOKEN'),

  // Duration string (`24h`, `30m`), not a number: `jsonwebtoken` reads a bare
  // number as *seconds*, so `86400000` means ~2.7 years, not 24 hours.
  RESET_TOKEN_EXPIRATION_TIME: z
    .string()
    .regex(
      /^\d+(ms|s|m|h|d)$/,
      'RESET_TOKEN_EXPIRATION_TIME must be a duration string like "24h" — a bare number is read as seconds',
    )
    .default('24h'),

  /** Serves Swagger and Scalar in production; off by default. */
  ENABLE_API_DOCS: booleanFromString.default(false),

  JWT_EXPIRY_SECONDS: numberFromString.pipe(z.number().max(MAX_JWT_LIFETIME_SECONDS)).default(900),
  MAIL_PORT: numberFromString.default(2525),
  FRONTEND_RESET_PASSWORD_URL: z.url().default('http://localhost:3000/auth/reset-password/'),

  // Parsed with `Number()` at the call site, where `??` does not catch `NaN`.
  // Validated here so a typo fails at boot rather than becoming `limit(NaN)`.
  NOTIFICATION_BROADCAST_CHUNK_SIZE: numberFromString.default(100),

  // Logging. Validated here so the booleans are real booleans and rotation
  // always has bounds — `winston-daily-rotate-file` with no `LOG_ROTATE_*`
  // keeps every file forever.
  ENABLE_LOGS: booleanFromString.default(true),
  SAVE_LOG_FILES: booleanFromString.default(false),
  DISABLE_CONSOLE_LOGS: booleanFromString.default(false),
  LOG_DIR: z.string().default('logs'),
  LOG_ROTATE_MAX_SIZE: z.string().default('20m'),
  LOG_ROTATE_MAX_FILES: z.string().default('14d'),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
});

// Single process validates the full superset (HTTP API + worker + scheduler run
// together), so apiSchema is the one schema.
export function validateEnv() {
  const result = apiSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Emit before the logger is constructed so the message is unmissable.

    console.error(`\n❌ Environment validation failed:\n${formatted}\n`);
    process.exit(1);
  }

  // Write the defaults Zod filled in back to `process.env`, so this schema is
  // the single source of truth for both validation and defaults —
  // `configuration.ts` reads `process.env` directly and would otherwise see
  // `undefined` for every defaulted key.
  //
  // Only absent keys are filled, so an operator-set value is never rewritten;
  // non-scalars are skipped rather than stringified into something misleading.
  for (const [key, value] of Object.entries(result.data)) {
    if (process.env[key] !== undefined) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    process.env[key] = String(value);
  }
}
