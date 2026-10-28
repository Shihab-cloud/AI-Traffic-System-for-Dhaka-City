/**
 * The stack the suite drives. It starts nothing itself: the frontend and the backend must already be
 * running, and the admin must already exist (the backend's seed module creates it). Every other
 * record a test needs it creates through the app.
 */
export interface E2eEnv {
  /** The frontend's origin, e.g. `http://localhost:3000`. */
  baseUrl: string;
  /** The backend's origin, without `/api`, e.g. `http://localhost:5001`. */
  apiUrl: string;
  adminEmail: string;
  adminPassword: string;
}

const REQUIRED = {
  baseUrl: 'E2E_BASE_URL',
  apiUrl: 'E2E_API_URL',
  adminEmail: 'E2E_ADMIN_EMAIL',
  adminPassword: 'E2E_ADMIN_PASSWORD',
} as const satisfies Record<keyof E2eEnv, string>;

/**
 * Reads the environment, or throws naming every variable that is missing.
 *
 * **It never skips.** A browser suite that skips when its stack is absent reports green with nothing
 * run, which is how the only coverage of a path disappears unnoticed. So in CI a missing variable
 * fails the run, and on a developer machine it refuses to start — both with the same list of what
 * to set.
 */
export function readE2eEnv(): E2eEnv {
  const missing = Object.values(REQUIRED).filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    const what = `missing ${missing.join(', ')}`;
    throw new Error(
      process.env.CI
        ? `E2E: ${what}. This suite is the only coverage of the operator journeys and cannot run ` +
            'without a running stack. It is allowed to refuse on a developer machine, never to ' +
            'pass in CI.'
        : `E2E: refusing to run — ${what}. Start the frontend and backend, then set ` +
            `${Object.values(REQUIRED).join(', ')} and run again. The suite does not skip: an unset ` +
            'environment is a refusal, not a pass.',
    );
  }

  return {
    baseUrl: trimSlash(process.env[REQUIRED.baseUrl]!),
    apiUrl: trimSlash(process.env[REQUIRED.apiUrl]!),
    adminEmail: process.env[REQUIRED.adminEmail]!,
    adminPassword: process.env[REQUIRED.adminPassword]!,
  };
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
