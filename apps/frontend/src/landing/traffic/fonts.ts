import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';

/** Engineered, slightly technical display face for headlines. */
export const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--traffic-display',
  display: 'swap',
});

/** Body text. */
export const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--traffic-body',
  display: 'swap',
});

/** Camera overlay, codes and measurements (the "HUD" voice). */
export const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--traffic-mono',
  display: 'swap',
});
