import { readE2eEnv } from './env';

/**
 * Runs once before any test, and not for `playwright test --list` — so the suite can be listed and
 * linted without a stack, but never run without one.
 */
export default function globalSetup(): void {
  readE2eEnv();
}
