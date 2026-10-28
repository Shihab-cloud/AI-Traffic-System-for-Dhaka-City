import '../styles/globals.css';

import ContextProvider from '@/providers/ContextProvider';
import { parseThemeSettings, THEME_COOKIE_NAME } from '@/lib/theme/theme-settings';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dhaka Traffic Enforcement',
  description: 'Vehicle detection, violations, tickets and fine payments for Dhaka roads',
};

const fontPrimary = Inter({ subsets: ['latin'] });

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the theme server-side so the first paint is already correct without
  // gating render on mount — a client-only preference would blank the
  // server-rendered body for every route.
  const themeSettings = parseThemeSettings((await cookies()).get(THEME_COOKIE_NAME)?.value);

  // suppressHydrationWarning: browser extensions (Grammarly, password managers, dark-mode tools) add attributes to
  // <html> / <body> before React hydrates. It only covers these two elements' own attributes, not their children.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${fontPrimary.className} antialiased`} suppressHydrationWarning>
        <ContextProvider initialThemeSettings={themeSettings}>{children}</ContextProvider>
      </body>
    </html>
  );
}
