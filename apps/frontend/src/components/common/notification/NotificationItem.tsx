'use client';

import { NotificationResponse } from '@/lib/dtos/response/notification.res';
import { NotificationChannelEnum } from '@/lib/enums/notification-channel.enum';
import { getChannelIcon } from '@/lib/notification/channel-icon';
import { timeAgo } from '@/lib/notification/time-ago';
import { Avatar, Box, Typography, alpha } from '@mui/material';

interface Props {
  notification: NotificationResponse;
  onClick?: (notification: NotificationResponse) => void;
  dense?: boolean;
}

/**
 * Pre-resolved channel -> lucide icon component map. Built once at module scope
 * so the icon is selected via property access during render rather than a call
 * that returns a component (which the static-components rule forbids).
 */
const CHANNEL_ICON_MAP: Record<NotificationChannelEnum, ReturnType<typeof getChannelIcon>> = {
  [NotificationChannelEnum.ANNOUNCEMENT]: getChannelIcon(NotificationChannelEnum.ANNOUNCEMENT),
  [NotificationChannelEnum.TO_USER]: getChannelIcon(NotificationChannelEnum.TO_USER),
  [NotificationChannelEnum.TO_USERS]: getChannelIcon(NotificationChannelEnum.TO_USERS),
  [NotificationChannelEnum.SUPPORT_TICKET_NOTIFY]: getChannelIcon(
    NotificationChannelEnum.SUPPORT_TICKET_NOTIFY,
  ),
  [NotificationChannelEnum.GENERAL]: getChannelIcon(NotificationChannelEnum.GENERAL),
};

/**
 * Renders the lucide icon for a notification channel via the module-scoped map
 * so no component is created during render.
 */
function ChannelIcon({
  channelType,
  size,
}: {
  channelType: NotificationChannelEnum;
  size: number;
}) {
  const Icon = CHANNEL_ICON_MAP[channelType] ?? CHANNEL_ICON_MAP[NotificationChannelEnum.GENERAL];
  return <Icon size={size} />;
}

/**
 * Single notification row.
 *
 * Unread rows are bolded with a 6px accent dot in the top-right; read rows
 * use normal weight and no dot. Icon is chosen by channel via
 * `getChannelIcon` so users can scan domains visually.
 */
export default function NotificationItem({ notification, onClick, dense = false }: Props) {
  const title = notification.title || 'Notification';
  const body = notification.messageContent;
  const unread = !notification.read;

  return (
    <Box
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={() => onClick?.(notification)}
      onKeyDown={
        onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick(notification) : undefined
      }
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        px: dense ? 2 : 2.5,
        py: dense ? 1.25 : 1.75,
        cursor: onClick ? 'pointer' : 'default',
        bgcolor: unread ? (t) => alpha(t.palette.primary.main, 0.04) : 'transparent',
        transition: 'background-color 0.15s',
        '&:hover': onClick
          ? { bgcolor: (t) => alpha(t.palette.primary.main, unread ? 0.08 : 0.04) }
          : undefined,
        '&:focus-visible': onClick
          ? { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 }
          : undefined,
      }}
    >
      <Avatar
        sx={{
          width: dense ? 32 : 36,
          height: dense ? 32 : 36,
          bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
          color: 'primary.main',
        }}
      >
        <ChannelIcon channelType={notification.channelType} size={dense ? 16 : 18} />
      </Avatar>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: dense ? 13 : 14,
            fontWeight: unread ? 600 : 500,
            lineHeight: 1.3,
            color: 'text.primary',
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            fontSize: dense ? 12 : 13,
            color: 'text.secondary',
            mt: 0.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: dense ? 2 : 3,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {body}
        </Typography>
        <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.5 }}>
          {timeAgo(notification.createdAt)}
        </Typography>
      </Box>

      {unread && (
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            mt: 1,
            flexShrink: 0,
          }}
        />
      )}
    </Box>
  );
}
