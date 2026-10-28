import { alpha } from '@mui/material/styles';
import type { Components, Theme } from '@mui/material/styles';
// Side-effect type import: registers the MuiPickers* component keys on
// `Components<Theme>`. Without it the MuiPickersInputBase / MuiPickersOutlinedInput
// entries below are type errors rather than silently-accepted `any` keys.
import type {} from '@mui/x-date-pickers/themeAugmentation';

export interface ComponentColors {
  primary: string;
  /** Ink for text/icons sitting on top of `primary` — e.g. the tooltip label. */
  primaryInk: string;
  secondary: string;
  success?: string;
  error?: string;
  ghost?: string;
  divider: string;
  paper: string;
  /** Body ink. Used to derive translucent rings and disabled grounds. */
  textPrimary: string;
  shadow: { paper: string; menu: string };
}

export interface ComponentShape {
  button: number;
  card: number;
  input: number;
  menuItem: number;
  pill: number;
}

export interface ComponentDensity {
  inputHeight: number;
}

export interface ComponentTypography {
  buttonWeight: number;
}

export function buildComponents(
  colors: ComponentColors,
  shape: ComponentShape,
  density: ComponentDensity,
  typography: ComponentTypography,
): Components<Theme> {
  const successColor = colors.success ?? colors.secondary;
  const errorColor = colors.error ?? '#DC4B4B';

  const tint = (color: string) => ({ backgroundColor: alpha(color, 0.12), color });

  const inputSurface = {
    backgroundColor: colors.paper,
    borderRadius: shape.input,
    minHeight: density.inputHeight,
    // The `paper` background above outranks MUI's own `Mui-disabled` styling, so
    // without this restatement a disabled field renders as if it were enabled.
    '&.Mui-disabled': { backgroundColor: alpha(colors.textPrimary, 0.05) },
  };

  return {
    MuiLink: { defaultProps: { underline: 'hover' } },
    MuiInputLabel: {
      styleOverrides: { shrink: { fontWeight: 600 } },
    },
    // The dropdown is a Paper, which has no shadow (below), so it needs its own edge.
    MuiAutocomplete: {
      styleOverrides: {
        paper: { border: `1px solid ${colors.divider}`, boxShadow: colors.shadow.menu },
      },
    },

    // Form controls and buttons keep MUI's own sizing: a size or padding set here would apply to
    // every size alike, so `size="small"` and `size="large"` would stop meaning anything.
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          borderRadius: shape.button,
          fontWeight: typography.buttonWeight,
        },
      },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { borderRadius: shape.card, boxShadow: colors.shadow.paper },
      },
      variants: [
        {
          props: { variant: 'outlined' },
          style: { border: `1px solid ${colors.divider}`, boxShadow: 'none' },
        },
      ],
    },
    MuiDialog: { styleOverrides: { paper: { boxShadow: colors.shadow.menu } } },
    MuiPopover: { styleOverrides: { paper: { boxShadow: colors.shadow.menu } } },
    MuiOutlinedInput: { styleOverrides: { root: inputSurface } },
    MuiPickersInputBase: { styleOverrides: { root: inputSurface } },
    MuiPickersOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: shape.input },
        notchedOutline: { borderRadius: shape.input },
      },
    },

    MuiChip: {
      styleOverrides: { root: { borderRadius: shape.pill } },
      variants: [
        { props: { variant: 'filled', color: 'primary' }, style: tint(colors.primary) },
        { props: { variant: 'filled', color: 'secondary' }, style: tint(colors.secondary) },
        { props: { variant: 'filled', color: 'success' }, style: tint(successColor) },
        { props: { variant: 'filled', color: 'error' }, style: tint(errorColor) },
      ],
    },

    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderBottom: `1px solid ${colors.divider}` } },
    },

    MuiTooltip: {
      styleOverrides: {
        arrow: { color: colors.primary },
        tooltip: {
          backgroundColor: colors.primary,
          color: colors.primaryInk,
          borderRadius: shape.menuItem,
        },
      },
    },

    MuiMenu: {
      styleOverrides: {
        paper: {
          border: `1px solid ${colors.divider}`,
          boxShadow: colors.shadow.menu,
        },
        list: { padding: '6px 0' },
      },
    },

    MuiMenuItem: {
      styleOverrides: { root: { margin: '0 6px', borderRadius: shape.menuItem } },
    },

    MuiAvatar: {
      styleOverrides: {
        root: { boxShadow: `0 0 0 1px ${alpha(colors.textPrimary, 0.12)}` },
      },
    },
  };
}
