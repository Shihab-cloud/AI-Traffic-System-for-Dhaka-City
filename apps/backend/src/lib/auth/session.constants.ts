/**
 * Session lifetime, in seconds. Better Auth's own default, pinned explicitly
 * because more than one place has to agree with it:
 *
 *  - `better-auth.ts` passes it as `session.expiresIn` (and it is the browser
 *    cookie's `maxAge`).
 *  - `mfa-session-state.store.ts` sizes the `expiresAt` of the AAL/AMR snapshot
 *    against it. This app persists that snapshot in the `mfa_session_state`
 *    Mongo TTL collection — backend-drizzle backs the same store with a Redis
 *    key, so do not read that app's TTL notes as describing this one.
 *
 * Because Better Auth sessions are rolling (`updateAge` pushes `expiresAt`
 * forward on the same session id), the store also re-arms that row on every
 * read; a row sized to this constant and written once would still expire
 * underneath a session that is being actively used.
 *
 * Kept in its own module so consumers do not have to import the whole Better
 * Auth wiring (and its mail dependencies) to read one number.
 */
export const SESSION_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
