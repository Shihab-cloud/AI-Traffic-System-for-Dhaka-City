'use client';

import { Chip, Typography, alpha } from '@mui/material';

import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { RouteUrls } from '@/lib/routes/route.config';
import { authClient, useSession } from '@/lib/auth-client';
import { generateAvatar } from '@/lib/utils/common.util';
import useAuthAction from '@/hooks/actions/useAuthAction';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icons } from '@/lib/icons';

export default function AccountMenu() {
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
      <Chip
        avatar={
          <Avatar
            src={session?.user.image || generateAvatar(session?.user.name || 'Guest')}
            alt={session?.user.name || 'Guest'}
          />
        }
        variant="outlined"
        label={session?.user.name || 'Loading...'}
        aria-label={session?.user.name || 'Account'}
        clickable
        onClick={handleClick}
        // The avatar alone on a phone: the name would push the chip past the edge of the top bar.
        sx={{
          borderRadius: 50,
          '& .MuiChip-label': { display: { xs: 'none', sm: 'block' } },
        }}
      />

      <Menu
        anchorEl={anchorEl}
        id="account-menu"
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{
          list: {
            dense: true,
          },
          paper: {
            elevation: 0,
            sx: {
              overflow: 'visible',
              mt: 1.5,
              '&::before': {
                content: '""',
                display: 'block',
                position: 'absolute',
                top: 0,
                right: 20,
                width: 12,
                height: 12,
                borderColor: 'divider',
                borderWidth: '1px 0 0 1px',
                bgcolor: 'inherit',
                transform: 'translateY(-50%) rotate(45deg)',
              },
            },
          },
        }}
      >
        <MenuItem onClick={() => handleNavigate(RouteUrls.profile.index)}>
          <Avatar
            src={session?.user.image || generateAvatar(session?.user.name || 'Guest')}
            alt={session?.user.name || 'Guest'}
            sx={{
              ml: -0.5,
              mr: 1,
              width: 32,
              height: 32,
              border: (theme) => `1px solid ${theme.custom.sidebar.accountAvatarBorder}`,
            }}
          />

          <div className="min-w-40">
            <Typography
              sx={{
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {session?.user.name || 'Loading...'}
            </Typography>
            <Typography sx={{ fontSize: 12 }}>{session?.user.email || 'Loading...'}</Typography>
          </div>
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
