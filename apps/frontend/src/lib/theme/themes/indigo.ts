import { alpha, createTheme } from '@mui/material/styles';
import { Inter } from 'next/font/google';
import { buildComponents } from '../buildComponents';

const inter = Inter({ subsets: ['latin'] });
const fontFamily = inter.style.fontFamily;

const light = {
  primary: '#312c68',
  primaryInk: '#FFFFFF',
  secondary: '#403899',
  success: '#384599',
  error: '#e07a7d',
  ghost: '#69687d',
  divider: '#e3e3e8',
  textPrimary: '#09090c',
  textSecondary: '#67647d',
  backgroundPrimary: '#eeeef7',
  backgroundSecondary: '#e6e5eb',
  paper: '#FFFFFF',
  shadow: {
    paper: '0 1px 2px rgba(20,20,10,0.04), 0 6px 20px rgba(20,20,10,0.06)',
    menu: '0 0 1px rgba(20,20,10,0.20), 0 8px 24px rgba(20,20,10,0.12)',
  },
};

const dark = {
  primary: '#4c60c2',
  primaryInk: '#091035',
  secondary: '#3e4ea3',
  success: '#3e4ea3',
  error: '#e58184',
  ghost: '#9c9eab',
  divider: '#FFFFFF1A',
  textPrimary: '#f9fafb',
  textSecondary: '#9c9eab',
  backgroundPrimary: '#16171d',
  backgroundSecondary: '#22232b',
  paper: '#09090c',
  shadow: {
    paper: '0 1px 2px rgba(0,0,0,0.50), 0 8px 24px rgba(0,0,0,0.60)',
    menu: '0 0 1px rgba(0,0,0,0.60), 0 12px 32px rgba(0,0,0,0.60)',
  },
};

const shape = { app: 12, button: 10, card: 16, input: 10, menuItem: 8, pill: 999 };
const density = { inputHeight: 44 };
const typography = {
  h4Weight: 700,
  h5Weight: 700,
  h6Weight: 650,
  bodyWeight: 500,
  buttonWeight: 600,
};

const lightSidebar = {
  background: light.backgroundSecondary,
  navItemHoverBg: alpha(light.textPrimary, 0.04),
  navItemText: light.textSecondary,
  navItemTextActive: light.secondary,
  navItemIcon: alpha(light.textPrimary, 0.48),
  navItemIconActive: light.secondary,
  navItemActiveBg: alpha(light.secondary, 0.16),
  navItemActiveBorder: light.secondary,
  navItemArrow: alpha(light.textPrimary, 0.4),
  navSectionLabel: alpha(light.textPrimary, 0.6),
  navBranchBorder: alpha(light.secondary, 0.3),
  navDivider: alpha(light.textPrimary, 0.08),
  accountPanelBorder: alpha(light.textPrimary, 0.1),
  accountPanelHoverBg: alpha(light.textPrimary, 0.04),
  accountPanelHoverBorder: alpha(light.textPrimary, 0.18),
  accountName: light.textPrimary,
  accountEmail: alpha(light.textPrimary, 0.6),
  accountIcon: alpha(light.textPrimary, 0.55),
  accountIconHover: light.textPrimary,
  accountAvatarBorder: alpha(light.textPrimary, 0.12),
  accountAvatarHoverRing: light.secondary,
};

const darkSidebar = {
  background: dark.backgroundSecondary,
  navItemHoverBg: alpha(dark.textPrimary, 0.05),
  navItemText: alpha(dark.textPrimary, 0.64),
  navItemTextActive: dark.secondary,
  navItemIcon: alpha(dark.textPrimary, 0.52),
  navItemIconActive: dark.secondary,
  navItemActiveBg: alpha(dark.primary, 0.18),
  navItemActiveBorder: dark.primary,
  navItemArrow: alpha(dark.textPrimary, 0.5),
  navSectionLabel: alpha(dark.textPrimary, 0.52),
  navBranchBorder: alpha(dark.primary, 0.3),
  navDivider: alpha(dark.textPrimary, 0.07),
  accountPanelBorder: alpha(dark.textPrimary, 0.1),
  accountPanelHoverBg: alpha(dark.textPrimary, 0.05),
  accountPanelHoverBorder: alpha(dark.textPrimary, 0.18),
  accountName: dark.textPrimary,
  accountEmail: alpha(dark.textPrimary, 0.55),
  accountIcon: alpha(dark.textPrimary, 0.55),
  accountIconHover: dark.textPrimary,
  accountAvatarBorder: alpha(dark.textPrimary, 0.14),
  accountAvatarHoverRing: dark.primary,
};

export const indigoTheme = {
  meta: {
    label: 'Indigo',
    previewColor: { light: light.primary, dark: dark.primary },
  },
  light: {
    mui: createTheme({
      shape: { borderRadius: shape.app },
      palette: {
        mode: 'light',
        primary: { main: light.primary, contrastText: light.primaryInk },
        secondary: { main: light.secondary, contrastText: '#ffffff' },
        success: { main: light.success, contrastText: '#ffffff' },
        error: { main: light.error },
        text: { primary: light.textPrimary, secondary: light.textSecondary },
        ghost: { main: light.ghost },
        divider: light.divider,
        background: {
          default: light.backgroundPrimary,
          paper: light.paper,
          secondary: light.backgroundSecondary,
        },
      },
      typography: {
        fontFamily,
        h4: { fontWeight: typography.h4Weight },
        h5: { fontWeight: typography.h5Weight },
        h6: { fontWeight: typography.h6Weight },
        body1: { fontWeight: typography.bodyWeight },
        body2: { fontWeight: typography.bodyWeight },
      },
      custom: { density, sidebar: lightSidebar },
      components: buildComponents(light, shape, density, { buttonWeight: typography.buttonWeight }),
    }),
  },
  dark: {
    mui: createTheme({
      shape: { borderRadius: shape.app },
      palette: {
        mode: 'dark',
        primary: { main: dark.primary, contrastText: dark.primaryInk },
        secondary: { main: dark.secondary },
        success: { main: dark.success, contrastText: '#0F1113' },
        error: { main: dark.error },
        text: { primary: dark.textPrimary, secondary: dark.textSecondary },
        ghost: { main: dark.ghost },
        divider: dark.divider,
        background: {
          default: dark.backgroundPrimary,
          paper: dark.paper,
          secondary: dark.backgroundSecondary,
        },
      },
      typography: {
        fontFamily,
        h4: { fontWeight: typography.h4Weight },
        h5: { fontWeight: typography.h5Weight },
        h6: { fontWeight: typography.h6Weight },
        body1: { fontWeight: typography.bodyWeight },
        body2: { fontWeight: typography.bodyWeight },
      },
      custom: { density, sidebar: darkSidebar },
      components: buildComponents(dark, shape, density, { buttonWeight: typography.buttonWeight }),
    }),
  },
};
