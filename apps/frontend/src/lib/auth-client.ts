import { jwtClient, usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { useSyncExternalStore } from 'react';
import { additionalFieldsPlugin } from './auth-fields';
import { WrappedSession } from './types/auth.types';

export { additionalFieldsPlugin };

export const authClient = createAuthClient({
  basePath: '/api/auth',
  // No `twoFactorClient()` — MFA is served by the backend's own `/api/mfa/*`
  // endpoints (see `lib/services/mfa.service.ts`), not Better Auth's plugin.
  plugins: [jwtClient(), usernameClient(), additionalFieldsPlugin],
});
export type UseSessionType = typeof authClient.useSession;

const noopSubscribe = () => () => {};

/**
 * The session, reported as still loading until the component has hydrated.
 *
 * The server never has the session (it renders "loading"), but in the browser Better Auth's store can already hold
 * it on the very first render (cached from an earlier page). Rendering it during hydration made the account menu
 * differ from the server HTML (avatar "User" vs the real name). After hydration the real value is returned at once.
 */
export function useSession(): WrappedSession {
  const session = authClient.useSession() as WrappedSession;
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return hydrated ? session : { ...session, data: null, isPending: true };
}
