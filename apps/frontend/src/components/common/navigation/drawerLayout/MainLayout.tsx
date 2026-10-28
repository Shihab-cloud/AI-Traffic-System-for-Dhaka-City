'use client';

import BreadcrumbRenderer from '@/components/common/breadcrumb/BreadcrumbRenderer';
import Footer from '@/components/common/footer/Footer';
import AppLogo from '@/components/common/logo/AppLogo';
import AccountMenu from '@/components/common/navigation/menu/AccountMenu';
import EnablePushAutoDialog from '@/components/common/notification/EnablePushAutoDialog';
import NotificationBell from '@/components/common/notification/NotificationBell';
import useDrawerState from '@/hooks/useDrawerState';
import { SidebarGroup } from '@/lib/routes/index.routes';
import { Box, IconButton, Drawer as MuiDrawer, Paper, Toolbar, useMediaQuery } from '@mui/material';
import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar';
import { CSSObject, Theme, styled, useTheme } from '@mui/material/styles';
import { useState } from 'react';
import DrawerContent from '../DrawerContent';
import { ScrollContainerContext } from './ScrollContainerContext';
import { Icons } from '@/lib/icons';

const drawerWidth = 272;

interface MainLayoutProps {
  children: React.ReactNode;
  sidebarItems: SidebarGroup[];
  /** Drawer state the server read from its cookie (null: none saved yet). */
  drawerOpen?: boolean | null;
}

const openedMixin = (theme: Theme): CSSObject => ({
  width: drawerWidth,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.easeInOut,
    duration: theme.transitions.duration.enteringScreen,
  }),
});

const closedMixin = (theme: Theme): CSSObject => ({
  width: `calc(${theme.spacing(9)} + 1px)`,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.easeInOut,
    duration: theme.transitions.duration.leavingScreen,
  }),
});

const DrawerHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: theme.spacing(0, 1),
  ...theme.mixins.toolbar,
}));

interface AppBarProps extends MuiAppBarProps {
  open?: boolean;
}

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== 'open',
})<AppBarProps>(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(['width', 'margin'], {
    easing: theme.transitions.easing.easeInOut,
    duration: theme.transitions.duration.standard,
  }),
  variants: [
    {
      props: ({ open }) => open,
      style: {
        marginLeft: drawerWidth,
        width: `calc(100% - ${drawerWidth}px)`,
        transition: theme.transitions.create(['width', 'margin'], {
          easing: theme.transitions.easing.easeInOut,
          duration: theme.transitions.duration.standard,
        }),
      },
    },
    {
      props: ({ open }) => !open,
      style: {
        marginLeft: `calc(${theme.spacing(9)} + 1px)`,
        width: '100%',
        [theme.breakpoints.up('md')]: {
          width: `calc(100% - ${theme.spacing(9)} - 1px)`,
        },
      },
    },
  ],
}));

const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== 'open',
})(({ theme }) => ({
  flexShrink: 0,
  boxSizing: 'border-box',
  overflowX: 'hidden',
  variants: [
    {
      props: ({ open }) => open,
      style: {
        ...openedMixin(theme),
        '& .MuiDrawer-paper': openedMixin(theme),
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

export default function MainLayout({ children, sidebarItems, drawerOpen = null }: MainLayoutProps) {
  const theme = useTheme();
  const breakpoint = useMediaQuery(theme.breakpoints.down('md'));

  const [open, setOpen] = useDrawerState('main', drawerOpen);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

  const handleDrawerClose = () => {
    setOpen(false);
  };

  const toggleDrawer = () => {
    setOpen((prev) => !prev);
  };

  // The foreground FCM listener lives in `useFcmRegistration` (mounted via
  // `EnablePushAutoDialog`). Adding one here double-fires every toast.

  return (
    <Box
      sx={{
        display: 'flex',
        maxWidth: '100vw',
        height: '100vh',
        overflow: 'hidden',
        bgcolor: (theme) => theme.custom.sidebar.background,
      }}
    >
      <AppBar
        position="fixed"
        open={open}
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 20,
          bgcolor: (theme) => theme.custom.sidebar.background,
          boxShadow: 0,
          border: 0,
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            aria-label={open ? 'Collapse navigation' : 'Expand navigation'}
            onClick={toggleDrawer}
            size="small"
            // 40px on a touch screen; the compact size only where there is a pointer to aim.
            sx={{ ml: { xs: 0, md: -4 }, p: { xs: 1.25, md: '5px' } }}
          >
            {open ? <Icons.sidebarCollapse size={20} /> : <Icons.sidebarExpand size={20} />}
          </IconButton>

          <BreadcrumbRenderer minimized={breakpoint} />

          <Box sx={{ flexGrow: 1 }} />
          <NotificationBell />
          <AccountMenu />
        </Toolbar>
      </AppBar>

      {/* Mobile drawer */}
      <MuiDrawer
        disableScrollLock={!breakpoint}
        variant="temporary"
        anchor="left"
        elevation={0}
        // Open only where it shows: an open modal aria-hides the rest of the page, even while CSS
        // keeps it out of sight on a desktop.
        open={breakpoint && open}
        onClose={handleDrawerClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          zIndex: theme.zIndex.drawer + 10,
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            border: 1,
            borderColor: 'divider',
            bgcolor: (theme) => theme.custom.sidebar.background,
          },
        }}
      >
        <DrawerHeader sx={{ pl: 2.5, justifyContent: 'start' }}>
          <AppLogo size={28} />
        </DrawerHeader>

        <DrawerContent items={sidebarItems} />
      </MuiDrawer>

      {/* Desktop permanent drawer */}
      <Drawer
        variant="permanent"
        open={open}
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': {
            boxShadow: 0,
            bgcolor: (theme) => theme.custom.sidebar.background,
            border: 0,
          },
        }}
      >
        <DrawerHeader sx={{ pl: 2.5, justifyContent: 'start' }}>
          <AppLogo size={28} iconOnly={!open} />
        </DrawerHeader>
        <DrawerContent items={sidebarItems} compact={!open} />
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          transition: theme.transitions.create('max-width', {
            easing: theme.transitions.easing.easeInOut,
            duration: theme.transitions.duration.standard,
          }),
          maxWidth: {
            xs: '100%',
            md: `calc(100% - ${open ? drawerWidth + 'px' : theme.spacing(9)})`,
          },
          bgcolor: (theme) => theme.custom.sidebar.background,
        }}
      >
        <DrawerHeader />
        <EnablePushAutoDialog />
        <Paper
          variant="outlined"
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            mt: 1,
            mb: 1,
            mr: 1,
            ml: { xs: 1, md: 0 },
            borderRadius: (theme) => `${Number(theme.shape.borderRadius) * 2}px`,
            // Clip the inner scroller to the rounded corners so the scrollbar
            // doesn't overhang the radius. The Box below is the actual scroller.
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <Box
            ref={setScrollContainer}
            sx={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
              minHeight: 0,
            }}
          >
            <ScrollContainerContext.Provider value={scrollContainer}>
              {children}
            </ScrollContainerContext.Provider>
            <Footer />
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
