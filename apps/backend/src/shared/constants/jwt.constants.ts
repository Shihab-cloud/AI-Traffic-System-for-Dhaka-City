/**
 * Ceiling on `JWT_EXPIRY_SECONDS`, enforced by `env.schema.ts`.
 *
 * The sign-out blocklist sizes its TTL from this rather than from the
 * configured lifetime, so the two cannot drift into a window where a revoked
 * token outlives the row that revokes it.
 */
export const MAX_JWT_LIFETIME_SECONDS = 24 * 60 * 60;

export const CLOCK_SKEW_MARGIN_SECONDS = 60;
