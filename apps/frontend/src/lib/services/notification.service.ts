import { APIUrl } from '@/lib/constants/url.config';
import { BroadcastNotificationRequest } from '@/lib/dtos/request/broadcast-notification.req';
import { RegisterDeviceTokenRequest } from '@/lib/dtos/request/register-device-token.req';
import { UpdateGlobalNotificationSettingsRequest } from '@/lib/dtos/request/update-notification-settings.req';
import {
  NotificationSettingsResponse,
  PaginatedNotificationResponse,
  UnreadNotificationCountResponse,
} from '@/lib/dtos/response/notification.res';
import { NotificationChannelEnum } from '@/lib/enums/notification-channel.enum';
import httpClient from '@/lib/utils/httpClient';

type NotificationInboxQuery = { page?: number; limit?: number; filter?: string[] };

class NotificationService {
  async getInbox(params: NotificationInboxQuery = {}) {
    const res = await httpClient.get<PaginatedNotificationResponse>(
      APIUrl.notification.getInbox(),
      {
        params,
      },
    );
    return res.data;
  }

  async getUnreadCount() {
    const res = await httpClient.get<UnreadNotificationCountResponse>(
      APIUrl.notification.getUnreadCount(),
    );
    return res.data;
  }

  async markRead(id: ID) {
    await httpClient.put<void>(APIUrl.notification.markRead(id));
  }

  async markAllRead() {
    await httpClient.put<void>(APIUrl.notification.markAllRead());
  }

  async registerDeviceToken(data: RegisterDeviceTokenRequest) {
    await httpClient.post<void>(APIUrl.notification.registerDeviceToken(), data);
  }

  async unregisterDeviceToken(token: string) {
    await httpClient.delete<void>(APIUrl.notification.unregisterDeviceToken(token));
  }

  async getUserSettings() {
    const res = await httpClient.get<NotificationSettingsResponse>(
      APIUrl.notification.getUserSettings(),
    );
    return res.data;
  }

  async updateUserSettings(data: UpdateGlobalNotificationSettingsRequest) {
    await httpClient.put<void>(APIUrl.notification.updateUserSettings(), data);
  }

  async getUserSettingsChannels() {
    const res = await httpClient.get<Partial<Record<NotificationChannelEnum, boolean>>>(
      APIUrl.notification.getUserChannelPreferences(),
    );
    return res.data;
  }

  async broadcast(data: BroadcastNotificationRequest) {
    await httpClient.post<void>(APIUrl.notification.broadcast(), data);
  }
}

const notificationService = new NotificationService();
export default notificationService;
