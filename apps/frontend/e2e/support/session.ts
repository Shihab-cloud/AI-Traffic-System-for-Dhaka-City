import { expect, type Page } from '@playwright/test';

import { readE2eEnv } from './env';

/**
 * Signs the admin in through the sign-in form, the way a person does.
 *
 * Fails, rather than carrying on half signed in, when the account is sent anywhere under `/auth/` —
 * an MFA challenge or the activation page means the admin given to the suite is not usable as-is.
 */
export async function signInAsAdmin(page: Page): Promise<void> {
  const { adminEmail, adminPassword } = readE2eEnv();

  await page.goto('/auth/signin');
  const form = page.getByTestId('signin-form');
  await form.getByLabel('Email or username').fill(adminEmail);
  // Exact: "Show password" on the visibility toggle also contains the word.
  await form.getByLabel('Password', { exact: true }).fill(adminPassword);
  await form.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL((url) => url.pathname !== '/auth/signin', { timeout: 30_000 });
  expect(
    new URL(page.url()).pathname,
    'the admin landed on an auth page after signing in — MFA or activation is pending for it',
  ).not.toMatch(/^\/auth\//);
}

/**
 * Calls the backend as the signed-in admin, for the setup a test needs and nothing else.
 *
 * The token is minted the way the app mints it — `GET /api/auth/token` on the frontend's origin,
 * carried by the session cookie the sign-in set — so a setup call has exactly the admin's rights.
 */
export async function adminApi(page: Page) {
  const { apiUrl } = readE2eEnv();

  const minted = await page.request.get('/api/auth/token');
  expect(minted.ok(), `minting a token failed: ${minted.status()}`).toBe(true);
  const { token } = (await minted.json()) as { token: string };

  return {
    async post<T>(path: string, data: unknown): Promise<T> {
      const res = await page.request.post(`${apiUrl}/api${path}`, {
        data,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok()) throw new Error(`POST ${path} → ${res.status()}: ${await res.text()}`);
      return (await res.json()) as T;
    },
  };
}

/** A name no earlier run used, so tests never collide with each other's records. */
export function uniqueName(prefix: string): string {
  return `E2E ${prefix} ${Date.now().toString(36)}`;
}
