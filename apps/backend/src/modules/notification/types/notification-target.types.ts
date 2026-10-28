import { NotificationTargetEnum } from '../../../shared/enums/notification-target.enum';
import type { NotificationMetadata } from 'src/lib/types/notification.types';

/**
 * Describes who a notification is addressed to.
 *
 *   'platform' — all platform users
 *   'users'    — an explicit list of user IDs (including single-user delivery)
 *
 * All targets are delivered asynchronously via the NOTIFICATION_BROADCAST queue.
 * Push opt-out is enforced downstream in NotifyUserService, not during user selection.
 */
export type NotificationTarget =
  | { type: NotificationTargetEnum.PLATFORM }
  | { type: NotificationTargetEnum.USERS; userIds: string[] };

/** Channel-agnostic notification content supplied by the publisher. */
export type NotificationContent = {
  messageContent: string;
  /** Overrides the channel's default title when provided. */
  title?: string;
  metadata?: NotificationMetadata;
  publisher?: string | null;
};
