import { NotificationChannelEnum } from '@/lib/enums/notification-channel.enum';
import React from 'react';
import { Icons } from '@/lib/icons';

/**
 * Returns the lucide icon component for a notification channel.
 * Falls back to a generic bell for unknown values.
 */
export function getChannelIcon(
  type: NotificationChannelEnum,
): React.ComponentType<{ size?: number }> {
  switch (type) {
    case NotificationChannelEnum.ANNOUNCEMENT:
      return Icons.announcement;
    case NotificationChannelEnum.TO_USER:
      return Icons.message;
    case NotificationChannelEnum.TO_USERS:
      return Icons.users;
    case NotificationChannelEnum.SUPPORT_TICKET_NOTIFY:
      return Icons.support;
    case NotificationChannelEnum.GENERAL:
    default:
      return Icons.notification;
  }
}
