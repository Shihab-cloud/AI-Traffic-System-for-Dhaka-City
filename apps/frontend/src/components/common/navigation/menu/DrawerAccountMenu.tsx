'use client';

import {
  Box,
  Collapse,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
  alpha,
  capitalize,
} from '@mui/material';
import { useContext, useState } from 'react';

import useAuthAction from '@/hooks/actions/useAuthAction';
import { authClient, useSession } from '@/lib/auth-client';
import { RouteUrls } from '@/lib/routes/route.config';
import { getThemeOptions } from '@/lib/theme/themeRegistry';
import { generateAvatar } from '@/lib/utils/common.util';
import { ThemeContext } from '@/providers/ThemeContextProvider';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useRouter } from 'next/navigation';
import { Icons } from '@/lib/icons';

const themeOptions = getThemeOptions().map((option) => ({
  ...option,
  label: capitalize(option.label),
}));

interface AccountMenuProps {
  compact?: boolean;
}

export default function DrawerAccountMenu({ compact }: AccountMenuProps) {
  const { darkMode, themeName, toggleDarkMode, setThemeName } = useContext(ThemeContext);

  const { signoutMutation } = useAuthAction();
  const router = useRouter();

  const { data: session } = useSession();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const open = Boolean(anchorEl);

  const onSignOut = () => {
    signoutMutation.mutate();
  };

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleNavigate = (path: string) => {
    handleClose();
    router.push(path);
  };

  return (
    <>
      <Collapse in={!compact}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            p: 1,
            borderRadius: 2,
            border: 1,
            borderColor: (theme) => theme.custom.sidebar.accountPanelBorder,
            transition: 'all 0.15s ease',
            '&:hover': {
              bgcolor: (theme) => theme.custom.sidebar.accountPanelHoverBg,
              borderColor: (theme) => theme.custom.sidebar.accountPanelHoverBorder,
            },
          }}
        >
          <Avatar
            src={session?.user.image || generateAvatar(session?.user.name || 'User')}
            alt={session?.user.name || 'User'}
            sx={{
              width: 34,
              height: 34,
              fontSize: 14,
              border: (theme) => `1px solid ${theme.custom.sidebar.accountAvatarBorder}`,
            }}
          />

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              noWrap
              sx={{
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.3,
                color: (theme) => theme.custom.sidebar.accountName,
              }}
            >
              {session?.user.name || 'Loading...'}
            </Typography>
            <Typography
              noWrap
              sx={{
                fontSize: 11,
                lineHeight: 1.3,
                color: (theme) => theme.custom.sidebar.accountEmail,
              }}
            >
              {session?.user.email || ''}
            </Typography>
          </Box>

          <IconButton
            size="small"
            onClick={handleClick}
            aria-label="Account menu"
            sx={{
              color: (theme) => theme.custom.sidebar.accountIcon,
              '&:hover': { color: (theme) => theme.custom.sidebar.accountIconHover },
            }}
          >
            <Icons.moreVertical size={18} />
          </IconButton>
        </Box>
      </Collapse>

      {compact && (
        <Tooltip title={session?.user.name || 'Loading...'} arrow placement="right">
          <Box
            onClick={handleClick}
            sx={{
              display: 'flex',
              justifyContent: 'center',
              cursor: 'pointer',
              py: 0.5,
            }}
          >
            <Avatar
              src={session?.user.image || generateAvatar(session?.user.name || 'Guest')}
              alt={session?.user.name || 'Guest'}
              sx={{
                width: 34,
                height: 34,
                fontSize: 14,
                border: (theme) => `1px solid ${theme.custom.sidebar.accountAvatarBorder}`,
                transition: 'box-shadow 0.15s ease',
                '&:hover': {
                  boxShadow: (theme) => `0 0 0 2px ${theme.custom.sidebar.accountAvatarHoverRing}`,
                },
              }}
            />
          </Box>
        </Tooltip>
      )}

      <Menu
        anchorEl={anchorEl}
        id="drawer-account-menu"
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{
          list: { dense: true },
          paper: { elevation: 0 },
        }}
      >
        {/* Appearance section */}
        <Box sx={{ px: 2.5, pb: 1 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: 1,
              fontSize: 10,
            }}
          >
            Appearance
          </Typography>
        </Box>

        {/* Dark mode toggle */}
        <MenuItem disableRipple onClick={toggleDarkMode} sx={{ px: 2 }}>
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              gap: 1,
              flexGrow: 1,
            }}
          >
            {darkMode ? <Icons.darkMode size={16} /> : <Icons.lightMode size={16} />}
            <Typography
              variant="body2"
              sx={{
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {darkMode ? 'Dark mode' : 'Light mode'}
            </Typography>
          </Stack>
          <Switch size="small" checked={darkMode} color="primary" tabIndex={-1} />
        </MenuItem>

        {/* Accent color swatches */}
        <MenuItem disableRipple sx={{ px: 2, py: 1.5, alignItems: 'flex-start' }}>
          <Stack
            direction="row"
            sx={{
              gap: 0.75,
              flexWrap: 'wrap',
              width: '100%',
              maxWidth: 248,
            }}
          >
            {themeOptions.map((t) => {
              const color = darkMode ? t.darkColor : t.lightColor;
              const isSelected = themeName === t.name;
              return (
                <Tooltip key={t.name} title={t.label} arrow placement="top">
                  <Box
                    onClick={() => setThemeName(t.name)}
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      backgroundColor: color,
                      cursor: 'pointer',
                      border: '2px solid',
                      borderColor: isSelected ? 'text.primary' : 'transparent',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      '&:hover': {
                        transform: 'scale(1.15)',
                        boxShadow: `0 0 0 3px ${alpha(color, 0.25)}`,
                      },
                    }}
                  >
                    {isSelected && (
                      <Box
                        sx={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          bgcolor: 'background.paper',
                          boxShadow: (theme) => theme.shadows[1],
                        }}
                      />
                    )}
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>
        </MenuItem>

        <Divider />

        {/* Profile */}
        <MenuItem
          onClick={() => handleNavigate(RouteUrls.profile.index)}
          sx={{ borderRadius: 1, py: 0.75 }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <Icons.profile size={18} />
          </ListItemIcon>
          <Typography sx={{ fontSize: 13 }}>Profile</Typography>
        </MenuItem>

        <Divider />

        {/* Logout */}
        <MenuItem
          onClick={onSignOut}
          sx={{
            borderRadius: 1,
            py: 0.75,
            color: 'error.main',
            '&:hover': {
              bgcolor: (t) => alpha(t.palette.error.main, 0.08),
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
            <Icons.logout size={18} />
          </ListItemIcon>
          <Typography sx={{ fontSize: 13 }}>Logout</Typography>
        </MenuItem>
      </Menu>
    </>
  );
}
