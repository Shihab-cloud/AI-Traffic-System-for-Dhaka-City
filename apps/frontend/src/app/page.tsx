import ActiveLanding from '@/landing/ActiveLanding';
import { ACTIVE_LANDING } from '@/landing/config';
import { LANDING_REGISTRY } from '@/landing/registry';
import type { Metadata } from 'next';

// The home page renders whichever landing `ACTIVE_LANDING` points to
// (see src/landing/config.ts). To restore the previous home page or remove
// the landing system entirely, follow src/landing/README.md.
const active = LANDING_REGISTRY[ACTIVE_LANDING];

export const metadata: Metadata = {
  title: active.label,
  description: active.description,
};

export default function HomePage() {
  return <ActiveLanding />;
}
