import type { DocumentType } from 'src/shared/enums/document-type.enum';
import type {
  DeliveryChannelEnum,
  DeliveryLogStatusEnum,
} from 'src/shared/enums/notification-delivery-status.enum';
import type { NotificationChannelEnum } from 'src/shared/enums/notification-channel.enum';

export interface NotificationMetadata {
  ids?: Array<{ documentType: DocumentType; documentId: string }>;
  event?: string;
}

export interface DeliveryLogEntry {
  channel: DeliveryChannelEnum;
  status: DeliveryLogStatusEnum;
  triedAt: string;
  sentAt: string | null;
  deferredAt: string | null;
  failedAt: string | null;
  error?: string | null;
}

/**
 * Domain notification event accepted by the publisher and persisted to the
 * notifications collection. Priority and silent/visible behaviour are *not* on
 * this DTO — they're derived from the channel meta at delivery time.
 */
export interface CreateNotificationDto {
  /** Id of the user who emitted this notification, or null/undefined for system-emitted. */
  publisher?: string | null;
  subscriber: string;
  channelType: NotificationChannelEnum;
  title?: string;
  messageContent: string;
  metadata?: NotificationMetadata;
  expiresAt?: Date;
}

/**
 * Persisted-row projection consumed by delivery adapters (FCM, email).
 * Adapters look up the channel meta for priority / silent flags.
 */
export interface NotificationDeliveryDto {
  id: string;
  userId: string;
  channelType: NotificationChannelEnum;
  title?: string | null;
  messageContent: string;
  metadata?: NotificationMetadata | null;
}

export interface ResolvedPrefs {
  push: boolean;
  deferred: boolean;
  emailFallback: boolean;
  emailEnabled: boolean;
}
