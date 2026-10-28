import type { ComponentType } from 'react';

import TrafficLanding from './traffic/TrafficLanding';
import type { LandingVariant } from './config';

export interface LandingMeta {
  key: LandingVariant;
  /** Human label, used in preview metadata. */
  label: string;
  /** One-line description for <meta> tags. */
  description: string;
  Component: ComponentType;
}

/**
 * Maps each variant key to its component + metadata. Add or remove a landing
 * by editing this single object (and the matching folder + LANDING_VARIANTS).
 */
export const LANDING_REGISTRY: Record<LandingVariant, LandingMeta> = {
  traffic: {
    key: 'traffic',
    label: 'Dhaka Traffic — AI traffic enforcement',
    description:
      'Cameras detect and track every vehicle and check eight traffic rules; officers verify each case; owners see the evidence, pay online or ask for a review.',
    Component: TrafficLanding,
  },
};
