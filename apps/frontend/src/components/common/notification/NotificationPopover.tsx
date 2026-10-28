'use client';

import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Popover,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import { NotificationResponse } from '@/lib/dtos/response/notification.res';
import NotificationEmpty from './NotificationEmpty';
import NotificationItem from './NotificationItem';
import { getDeepLink } from '@/lib/notification/deep-link';
import type { AppRole } from '@/lib/notification/deep-link';
import useNotificationAction from '@/hooks/actions/useNotificationAction';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';

interface Props {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}

const POPOVER_WIDTH = 380;
const POPOVER_MAX_HEIGHT = 480;

/**
 * Bell dropdown — first 10 notifications with mark-all-read and see-all affordances.
 *
 * Mark-read fires optimistically on item click; deep-link navigation happens
 * immediately so there's no perceived lag. The full inbox link routes to
 * /notifications which is role-agnostic (all roles share that route).
 */
export default function NotificationPopover({ anchorEl, open, onClose }: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role?.name as AppRole | undefined;
  const { useInboxQuery, useUnreadCountQuery, markReadMutation, markAllReadMutation } =
    useNotificationAction();
  const inboxQuery = useInboxQuery(1, 10);
  const items = inboxQuery.data?.data ?? [];
  const { data: unreadData } = useUnreadCountQuery();

  const handleItemClick = (notification: NotificationResponse) => {
    if (!notification.read) {
      markReadMutation.mutate(notification.id);
    }
    onClose();
    router.push(getDeepLink(notification.metadata, role));
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate(undefined);
  };

  return (
    <Popover
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            width: POPOVER_WIDTH,
            maxHeight: POPOVER_MAX_HEIGHT,
            mt: 1.5,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Notifications</Typography>
        <Button
          size="small"
          onClick={handleMarkAllRead}
          disabled={!unreadData?.count || markAllReadMutation.isPending}
          sx={{ textTransform: 'none', fontSize: 12 }}
        >
          Mark all read
        </Button>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', minHeight: 180 }}>
        {inboxQuery.isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}>
            <CircularProgress size={24} />
          </Box>
        ) : inboxQuery.isError ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography
              sx={{
                fontSize: 13,
                color: 'error.main',
              }}
            >
              Failed to load notifications.
            </Typography>
          </Box>
        ) : items.length === 0 ? (
          <NotificationEmpty variant="popover" />
        ) : (
          <Stack divider={<Divider />}>
            {items.map((n) => (
              <NotificationItem key={n.id} notification={n} onClick={handleItemClick} dense />
            ))}
          </Stack>
        )}
      </Box>

      <Box
        sx={{
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
        }}
      >
        <Button
          fullWidth
          onClick={() => {
            onClose();
            router.push('/notifications');
          }}
          sx={{ textTransform: 'none', fontSize: 13, py: 1.25 }}
        >
          See all notifications
        </Button>
      </Box>
    </Popover>
  );
}
