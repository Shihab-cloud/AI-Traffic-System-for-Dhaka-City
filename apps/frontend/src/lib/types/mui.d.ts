import '@mui/material/styles';
import '@mui/material/Button';
import '@mui/material/Paper';

declare module '@mui/material/styles' {
  interface TypeBackground {
    secondary: string;
  }

  interface Palette {
    ghost: Palette['primary'];
  }

  interface PaletteOptions {
    ghost?: PaletteOptions['primary'];
  }

  interface Theme {
    custom: {
      density: {
        inputHeight: number;
      };
      sidebar: {
        background: string;
        navItemHoverBg: string;
        navItemText: string;
        navItemTextActive: string;
        navItemIcon: string;
        navItemIconActive: string;
        navItemActiveBg: string;
        navItemActiveBorder: string;
        navItemArrow: string;
        navSectionLabel: string;
        navBranchBorder: string;
        navDivider: string;
        accountPanelBorder: string;
        accountPanelHoverBg: string;
        accountPanelHoverBorder: string;
        accountName: string;
        accountEmail: string;
        accountIcon: string;
        accountIconHover: string;
        accountAvatarBorder: string;
        accountAvatarHoverRing: string;
      };
    };
  }

  interface ThemeOptions {
    custom?: Theme['custom'];
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsColorOverrides {
    ghost: true;
  }
  interface ButtonPropsVariantOverrides {
    'keeper-pill': true;
    'keeper-cta': true;
  }
}

declare module '@mui/material/Paper' {
  interface PaperPropsVariantOverrides {
    'keeper-hero': true;
    'keeper-stat': true;
  }
}
