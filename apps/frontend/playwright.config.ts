import { defineConfig, devices } from '@playwright/test';

/**
 * The browser suite. It drives an already-running stack named by `E2E_*` variables and starts no
 * server itself; `e2e/support/env.ts` lists them and refuses to run without them.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/support/global-setup.ts',
  // Tests create records through the app and share one admin; one worker keeps them from racing.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
