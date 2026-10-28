import { NotificationChannelEnum } from '@/lib/enums/notification-channel.enum';

export interface UpdateGlobalNotificationSettingsRequest {
  pushEnabled?: boolean;
  emailFallbackEnabled?: boolean;
  criticalBypassQuietHours?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timezone?: string;
  preferences?: Partial<Record<NotificationChannelEnum, boolean>>;
}
