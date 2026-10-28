import { ACTIVE_LANDING } from './config';
import { LANDING_REGISTRY } from './registry';

/**
 * Renders whichever landing `ACTIVE_LANDING` (config.ts) points to.
 * Used by `app/page.tsx` so the site root always shows the chosen variant.
 */
export default function ActiveLanding() {
  const { Component } = LANDING_REGISTRY[ACTIVE_LANDING];
  return <Component />;
}
