import { NotificationDevicePlatformEnum } from '@/lib/enums/notification-device-platform.enum';

export interface RegisterDeviceTokenRequest {
  token: string;
  platform: NotificationDevicePlatformEnum;
}
