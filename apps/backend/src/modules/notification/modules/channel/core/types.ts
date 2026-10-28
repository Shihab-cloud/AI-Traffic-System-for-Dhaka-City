import { NotificationChannelEnum } from '../../../../../shared/enums/notification-channel.enum';
import { NotificationTargetEnum } from '../../../../../shared/enums/notification-target.enum';
import { NotificationPriorityEnum } from '../../../../../shared/enums/notification-priority.enum';
import type { NotificationMetadata } from 'src/lib/types/notification.types';

/** Audience of a single dispatch. Same shape used by router/processor. */
export type Target =
  | { type: NotificationTargetEnum.PLATFORM }
  | { type: NotificationTargetEnum.USERS; userIds: string[] };

/** Static per-channel configuration. Lives on each channel class as `static readonly meta`. */
export interface ChannelMeta {
  type: NotificationChannelEnum;
  push: boolean;
  email: boolean;
  priority: NotificationPriorityEnum;
  ttlDays: number;
  silent?: boolean;
  title: string;
  /** Required when `email: true`. EJS template path under `modules/email/templates/`. */
  emailTemplate?: string;
}

/**
 * Per-recipient content slice. Used for both the channel's flat default
 * (`ChannelOutput.content`) and optional userId-keyed personalization
 * (`ChannelOutput.perUserContent`).
 */
export interface PerUserContent {
  messageContent: string;
  title?: string;
  metadata?: NotificationMetadata;
}

/**
 * Output of a channel's `build()` — what to send and to whom.
 *
 * `defaultContent` is delivered to every recipient that does not have a
 * `contentByUserId[userId]` override. Same shape as a per-user entry.
 *
 * `contentByUserId` (optional) is a userId → personalized content map.
 * Use when the caller already has per-recipient data (e.g. a billing service
 * computed each recipient's amount) and wants each recipient to receive their
 * own personalized text without N publish calls. Recipients in the resolved
 * target without an entry in this map fall back to `defaultContent`.
 *
 * `publisher` is per-notification, not per-recipient — id of the user who
 * emitted this notification, or null/undefined for system-emitted.
 */
export interface ChannelOutput {
  target: Target;
  defaultContent: PerUserContent;
  publisher?: string | null;
  contentByUserId?: Record<string, PerUserContent>;
}

/**
 * Base payload every channel accepts. Caller can pass these on any channel to
 * override the channel's composed defaults. All optional — domain channels
 * usually compose `message`/`title` from richer payload fields and treat these
 * as escape-hatch overrides.
 *
 * Domain channels MUST extend this (not replace) — `ChannelHandler<P>` is
 * constrained so a payload missing the default fields is a compile error.
 */
export interface DefaultChannelPayload {
  /** Optional override of the channel's composed/default title. */
  title?: string;
  /** Optional override of the channel's composed message text. */
  message?: string;
  /** Optional structured metadata (document refs, tracking ids, etc.). */
  metadata?: NotificationMetadata;
}

/**
 * Implemented by every channel class. Generic P is the payload shape supplied
 * by callers; constrained to extend `DefaultChannelPayload` so the base
 * override fields are always available.
 */
export interface ChannelHandler<P extends DefaultChannelPayload = DefaultChannelPayload> {
  build(payload: P): Promise<ChannelOutput> | ChannelOutput;
}

/** Per-call overrides supplied by the caller. Each field overrides the channel's static meta. */
export interface PublishOverrides {
  push?: boolean;
  email?: boolean;
  priority?: NotificationPriorityEnum;
  title?: string;
  target?: Target;
}

/** Delivery-flag subset of PublishOverrides — threaded through the broadcast pipeline. */
export type DeliveryOverrides = Pick<PublishOverrides, 'push' | 'email' | 'priority'>;
