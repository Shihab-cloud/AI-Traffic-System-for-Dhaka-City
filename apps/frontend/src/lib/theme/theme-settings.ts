import { DEFAULT_THEME } from '@/lib/theme/themeRegistry';

/*
 * The theme cookie's name and format, shared by the server layout (which reads it for the first
 * paint) and `ThemeContextProvider` (which writes it). Deliberately not a client module: the
 * server cannot call a function exported from a `'use client'` file, and the root layout calling
 * one crashed every page.
 */

/**
 * Cookie, not localStorage, because the server layout reads it — that is what
 * lets the first paint be correct without gating render on mount.
 */
export const THEME_COOKIE_NAME = 'app-theme';

export interface ThemeSettings {
  darkMode: boolean;
  themeName: string;
}

export const defaultThemeSettings: ThemeSettings = {
  darkMode: false,
  themeName: DEFAULT_THEME,
};

/**
 * Parse the cookie `ThemeContextProvider` writes. Returns defaults for anything unparseable — a
 * corrupt cookie must not blank the app.
 */
export function parseThemeSettings(raw: string | undefined): ThemeSettings {
  if (!raw) return defaultThemeSettings;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<ThemeSettings>;
    return {
      darkMode: typeof parsed.darkMode === 'boolean' ? parsed.darkMode : false,
      themeName: typeof parsed.themeName === 'string' ? parsed.themeName : DEFAULT_THEME,
    };
  } catch {
    return defaultThemeSettings;
  }
}
