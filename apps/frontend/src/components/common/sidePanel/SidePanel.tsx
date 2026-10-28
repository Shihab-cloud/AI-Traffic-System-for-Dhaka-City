'use client';

import { Drawer as MuiDrawer, Toolbar } from '@mui/material';
import { CSSObject, Theme, styled } from '@mui/material/styles';

import { ResponsiveStyleValue } from '@mui/system';

interface SidePanelProps {
  children: React.ReactNode;
  open: boolean;
  onClose: () => void;
  anchor: 'left' | 'right';
  width: CSSObject['width'];
  mobileWidth?: ResponsiveStyleValue<CSSObject['width']>;
}

const openedMixin = (theme: Theme, width: CSSObject['width']): CSSObject => ({
  width: width,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
});

const closedMixin = (theme: Theme): CSSObject => ({
  width: 0,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
});

/**
 * Permanent (desktop) drawer with open/closed width transitions. Module-scoped
 * so the styled component is created once, not during SidePanel's render. The
 * open width is passed through the transient `panelWidth` prop.
 */
const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== 'open' && prop !== 'panelWidth',
})<{ panelWidth: CSSObject['width'] }>(({ theme, panelWidth }) => ({
  flexShrink: 0,
  variants: [
    {
      props: ({ open }) => open,
      style: {
        ...openedMixin(theme, panelWidth),
        '& .MuiDrawer-paper': openedMixin(theme, panelWidth),
      },
    },
    {
      props: ({ open }) => !open,
      style: {
        ...closedMixin(theme),
        '& .MuiDrawer-paper': closedMixin(theme),
      },
    },
  ],
}));

export default function SidePanel({
  children,
  open,
  onClose,
  anchor,
  width,
  mobileWidth = '100%',
}: SidePanelProps) {
  return (
    <>
      <MuiDrawer
        disableScrollLock={!open}
        variant="temporary"
        open={open}
        anchor={anchor}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: mobileWidth,
            borderTop: 0,
            borderBottom: 0,
          },
        }}
      >
        <Toolbar />
        {children}
      </MuiDrawer>

      <Drawer
        variant="permanent"
        open={open}
        anchor={anchor}
        panelWidth={width}
        sx={{
          display: { xs: 'none', md: 'block' },
          position: 'relative',
          overflowX: 'hidden',
          '& .MuiDrawer-paper': {
            width: width,
            position: 'absolute',
            borderTop: 0,
            borderBottom: 0,
          },
        }}
      >
        {children}
      </Drawer>
    </>
  );
}
