import { inferAdditionalFields } from 'better-auth/client/plugins';

/**
 * Mirror of `user.additionalFields` and `session.additionalFields` declared in Backend:
 * `apps/backend/src/lib/auth/better-auth.ts`.
 *
 * Its own module, free of React, because `proxy.ts` (middleware, server-side) needs it too: Next.js refuses React
 * hooks anywhere in the middleware's imports, and `auth-client.ts` has the `useSession` hook.
 */
export const additionalFieldsPlugin = inferAdditionalFields({
  user: {
    firstName: { type: 'string', required: true },
    lastName: { type: 'string', required: true },
    username: { type: 'string', required: false },
    displayUsername: { type: 'string', required: false },
    mustResetPassword: { type: 'boolean', required: false },
    phone: { type: 'string', required: false },
    roleId: { type: 'string', required: false },
    status: { type: 'string', required: false },
    lastLoginAt: { type: 'date', required: false },
    role: { type: 'json', required: false, input: false },
  },
  session: {
    aal: { type: 'number', required: false, input: false },
    enrollment_required: { type: 'boolean', required: false, input: false },
    activation_required: { type: 'boolean', required: false, input: false },
  },
});
