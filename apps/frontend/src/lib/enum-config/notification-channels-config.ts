import { NotificationChannelEnum } from '@/lib/enums/notification-channel.enum';
import { RoleNameEnum } from '@/lib/enums/role-name.enum';

/** Human-readable labels for every notification channel the backend supports. */
export const CHANNEL_LABELS: Record<
  NotificationChannelEnum,
  { title: string; description: string }
> = {
  [NotificationChannelEnum.GENERAL]: {
    title: 'General',
    description: 'General platform notifications such as account activity and updates.',
  },
  [NotificationChannelEnum.ANNOUNCEMENT]: {
    title: 'Announcements',
    description: 'Platform-wide announcements broadcast by an administrator.',
  },
  [NotificationChannelEnum.TO_USER]: {
    title: 'Direct notifications',
    description: 'Notifications addressed specifically to you.',
  },
  [NotificationChannelEnum.TO_USERS]: {
    title: 'Group notifications',
    description: 'Notifications sent to a group you belong to.',
  },
  [NotificationChannelEnum.SUPPORT_TICKET_NOTIFY]: {
    title: 'Support tickets',
    description: 'Activity on your support tickets — new replies, status changes, and resolutions.',
  },
};

/**
 * Channels each role can actually receive, derived from the backend channel
 * registry. Only the channels that will deliver to a given role are shown in
 * the preferences page — otherwise users see dead switches that do nothing.
 */
export const CHANNELS_BY_ROLE: Partial<Record<RoleNameEnum, NotificationChannelEnum[]>> = {
  [RoleNameEnum.USER]: [
    NotificationChannelEnum.GENERAL,
    NotificationChannelEnum.ANNOUNCEMENT,
    NotificationChannelEnum.TO_USER,
    NotificationChannelEnum.SUPPORT_TICKET_NOTIFY,
  ],
  [RoleNameEnum.ADMIN]: Object.values(NotificationChannelEnum),
};
