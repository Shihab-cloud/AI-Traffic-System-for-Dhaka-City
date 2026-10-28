import { expect, test } from '@playwright/test';

import { expectAccessible } from './support/a11y';
import { signInAsAdmin } from './support/session';

test('an admin signs in with email and password and lands on a protected page', async ({
  page,
}) => {
  await signInAsAdmin(page);

  // The app shell, which only a signed-in session renders.
  await expect(page.getByRole('button', { name: /navigation$/ })).toBeVisible();
  await expectAccessible(page, 'the landing page after sign-in');
});

test('the sign-in page has no serious or critical accessibility violation', async ({ page }) => {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('signin-form')).toBeVisible();
  await expectAccessible(page, 'sign-in');

  // The visibility toggle is an icon alone; its name is all a screen reader has.
  await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible();
});

test('the legal pages open signed out, with no serious accessibility violation', async ({
  page,
}) => {
  for (const path of ['/privacy-policy', '/terms']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessible(page, path);
  }
});
