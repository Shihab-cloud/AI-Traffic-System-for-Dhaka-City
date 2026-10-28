import { Injectable } from '@nestjs/common';
import type { DeliveryLogEntry } from 'src/lib/types/notification.types';
import {
  DeliveryChannelEnum,
  DeliveryLogStatusEnum,
} from 'src/shared/enums/notification-delivery-status.enum';
import { NotificationPriorityEnum } from 'src/shared/enums/notification-priority.enum';
import type { NotificationDeliveryDto, ResolvedPrefs } from 'src/lib/types/notification.types';
import { ChannelRegistryService } from '../../modules/channel/core/channel-registry.service';
import { DeviceTokenService } from '../../modules/fcm/device-token.service';
import { FcmService } from '../../modules/fcm/fcm.service';

@Injectable()
export class PushDeliveryService {
  constructor(
    private readonly fcmService: FcmService,
    private readonly deviceTokenService: DeviceTokenService,
    private readonly channelRegistry: ChannelRegistryService,
  ) {}

  isEnabled(_dto: NotificationDeliveryDto, prefs: ResolvedPrefs): boolean {
    return prefs.push;
  }

  /**
   * Delivers a push notification to all of the user's registered device tokens
   * via FcmService (Firebase Admin, web push).
   *
   * Returns a DeliveryLogEntry reflecting the outcome: SENT if at least one
   * token was delivered, FAILED if tokens existed but the send failed, and
   * null when the user has no registered tokens.
   */
  async deliver(dto: NotificationDeliveryDto): Promise<DeliveryLogEntry | null> {
    const tokens = await this.deviceTokenService.findForUser(dto.userId);
    if (tokens.length === 0) return null;

    const fcmTokens = tokens.map((t) => t.token);

    const meta = this.channelRegistry.meta(dto.channelType);
    const payload = {
      title: dto.title ?? '',
      body: dto.messageContent,
      data: {
        notificationId: dto.id,
        channelType: dto.channelType,
        documentType: dto.metadata?.ids?.[0]?.documentType ?? '',
      },
    };
    const options = {
      isHighPriority: meta.priority === NotificationPriorityEnum.CRITICAL,
      isSilent: meta.silent ?? false,
    };

    const triedAt = new Date().toISOString();
    const result = await this.fcmService.sendMulticast(fcmTokens, payload, options);

    if (result.status === 'NO_TOKENS') return null;

    const sent = result.status === 'SENT';
    const now = new Date().toISOString();
    return {
      channel: DeliveryChannelEnum.FCM,
      status: sent ? DeliveryLogStatusEnum.SENT : DeliveryLogStatusEnum.FAILED,
      triedAt,
      sentAt: sent ? now : null,
      deferredAt: null,
      failedAt: sent ? null : now,
    };
  }
}
