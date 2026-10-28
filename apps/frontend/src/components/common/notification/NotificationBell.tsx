'use client';

import { Badge, IconButton, Tooltip } from '@mui/material';
import NotificationPopover from './NotificationPopover';
import useNotificationAction from '@/hooks/actions/useNotificationAction';
import { useState } from 'react';
import { Icons } from '@/lib/icons';

/**
 * Header bell — opens the NotificationPopover and shows an unread count badge.
 *
 * The unread count comes from the React Query cache, not a dedicated fetch.
 * Badge caps at 99+ to avoid layout jitter.
 */
export default function NotificationBell() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const { useUnreadCountQuery } = useNotificationAction();
  const { data } = useUnreadCountQuery();
  const count = data?.count ?? 0;

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          onClick={handleOpen}
          size="small"
          aria-label={`Notifications, ${count} unread`}
          // 40px on a touch screen; the compact size only where there is a pointer to aim.
          sx={{ p: { xs: 1.25, md: '5px' } }}
        >
          <Badge
            badgeContent={count}
            color="error"
            max={99}
            overlap="circular"
            sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }}
          >
            <Icons.notification size={20} />
          </Badge>
        </IconButton>
      </Tooltip>
      <NotificationPopover anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose} />
    </>
  );
}
