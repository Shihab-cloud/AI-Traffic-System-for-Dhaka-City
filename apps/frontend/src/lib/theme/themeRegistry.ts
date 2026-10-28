import { blueTheme } from './themes/blue';
import { emeraldTheme } from './themes/emerald';
import { indigoTheme } from './themes/indigo';
import { oliveTheme } from './themes/olive';
import { tealTheme } from './themes/teal';
import { violetTheme } from './themes/violet';

export const themeRegistry = {
  emerald: emeraldTheme,
  blue: blueTheme,
  indigo: indigoTheme,
  olive: oliveTheme,
  teal: tealTheme,
  violet: violetTheme,
} as const;

export type ThemeName = keyof typeof themeRegistry;

export const DEFAULT_THEME: ThemeName = 'indigo';

export const getThemeOptions = () =>
  (Object.keys(themeRegistry) as ThemeName[]).map((name) => ({
    name,
    label: themeRegistry[name].meta.label,
    lightColor: themeRegistry[name].meta.previewColor.light,
    darkColor: themeRegistry[name].meta.previewColor.dark,
  }));
