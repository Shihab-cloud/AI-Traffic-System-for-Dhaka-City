import { DocumentType } from '@/lib/enums/document-type.enum';
import { NotificationChannelEnum } from '@/lib/enums/notification-channel.enum';

interface NotificationMetadataRef {
  documentType: DocumentType;
  documentId: string;
}

export interface NotificationMetadata {
  ids?: NotificationMetadataRef[];
  event?: string;
}

export interface DeliveryLogEntry {
  attemptedAt: string;
  fcmStatus?: 'sent' | 'failed' | 'skipped';
  fcmDeliveredAt?: string;
  emailStatus?: 'sent' | 'failed' | 'skipped';
  emailDeliveredAt?: string;
  deferredAt?: string;
  deferUntil?: string;
  deferAttempt?: number;
  droppedAt?: string;
  dropReason?: string;
}

export interface NotificationResponse extends BaseResponse {
  channelType: NotificationChannelEnum;
  title: string | null;
  messageContent: string;
  metadata: NotificationMetadata | null;
  read: boolean;
  deliveryLogs: DeliveryLogEntry[];
  expiresAt: string | null;
}

export interface PaginatedNotificationResponse {
  data: NotificationResponse[];
  total: number;
  page: number;
  limit: number;
}

export interface UnreadNotificationCountResponse {
  count: number;
}

export interface NotificationSettingsResponse extends BaseResponse {
  userId: string;
  pushEnabled: boolean;
  emailFallbackEnabled: boolean;
  criticalBypassQuietHours: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
  preferences: Partial<Record<NotificationChannelEnum, boolean>> | null;
}
