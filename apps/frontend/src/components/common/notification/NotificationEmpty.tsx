'use client';

import { Box, Typography } from '@mui/material';
import { Icons } from '@/lib/icons';

interface Props {
  variant?: 'popover' | 'page';
}

/**
 * Shared empty state.
 *
 * Two sizes so it fits both the 380px-wide popover and the full inbox page
 * without visual compromise.
 */
export default function NotificationEmpty({ variant = 'popover' }: Props) {
  const compact = variant === 'popover';
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: compact ? 4 : 10,
        px: 2,
        color: 'text.secondary',
        minHeight: compact ? 180 : 320,
      }}
    >
      <Icons.notificationsOff size={compact ? 36 : 48} strokeWidth={1.5} />
      <Typography
        sx={{ mt: 2, fontSize: compact ? 14 : 16, fontWeight: 500, color: 'text.primary' }}
      >
        No notifications yet
      </Typography>
      <Typography sx={{ mt: 0.5, fontSize: compact ? 12 : 13, textAlign: 'center', maxWidth: 360 }}>
        When you receive notifications, they&apos;ll show up here.
      </Typography>
    </Box>
  );
}
