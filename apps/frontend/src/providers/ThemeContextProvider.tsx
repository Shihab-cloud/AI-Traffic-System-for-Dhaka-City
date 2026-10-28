'use client';

import {
  defaultThemeSettings,
  THEME_COOKIE_NAME,
  type ThemeSettings,
} from '@/lib/theme/theme-settings';
import { DEFAULT_THEME, themeRegistry, type ThemeName } from '@/lib/theme/themeRegistry';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';

/** A year — a display preference has no reason to expire sooner. */
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const ThemeContext = createContext({
  darkMode: false,
  themeName: DEFAULT_THEME as string,
  toggleDarkMode: () => {},
  setThemeName: (_name: string) => {},
});

function persist(settings: ThemeSettings) {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(JSON.stringify(settings));
  // `SameSite=Lax` is enough: this is a display preference, not a credential,
  // and it must survive a top-level navigation back into the app.
  document.cookie = `${THEME_COOKIE_NAME}=${value}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

function ThemeContextProvider({
  children,
  initialSettings = defaultThemeSettings,
}: {
  children: React.ReactNode;
  /** Read from the cookie by the server layout, so the first paint is correct. */
  initialSettings?: ThemeSettings;
}) {
  const [settings, setSettings] = useState<ThemeSettings>(initialSettings);

  const update = useCallback((next: ThemeSettings) => {
    persist(next);
    setSettings(next);
  }, []);

  const toggleDarkMode = useCallback(
    () => update({ ...settings, darkMode: !settings.darkMode }),
    [settings, update],
  );

  const setThemeName = useCallback(
    (name: string) => update({ ...settings, themeName: name }),
    [settings, update],
  );

  useEffect(() => {
    document.body.classList.toggle('dark', settings.darkMode);
  }, [settings.darkMode]);

  const theme = useMemo(() => {
    const entry = themeRegistry[settings.themeName as ThemeName] ?? themeRegistry[DEFAULT_THEME];
    return settings.darkMode ? entry.dark.mui : entry.light.mui;
  }, [settings.darkMode, settings.themeName]);

  const value = useMemo(
    () => ({
      darkMode: settings.darkMode,
      themeName: settings.themeName,
      toggleDarkMode,
      setThemeName,
    }),
    [settings.darkMode, settings.themeName, toggleDarkMode, setThemeName],
  );

  // Children render unconditionally — see the note on THEME_COOKIE_NAME.
  return (
    <ThemeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}

export { ThemeContext, ThemeContextProvider };
