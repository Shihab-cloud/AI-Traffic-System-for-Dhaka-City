import { Injectable } from '@nestjs/common';
import { NotificationChannelEnum } from '../../../shared/enums/notification-channel.enum';
import type { NotificationContent, NotificationTarget } from '../types/notification-target.types';
import type { DeliveryOverrides, PerUserContent } from '../modules/channel/core/types';
import { NotifyChannelSubscribersService } from './notify-channel-subscribers.service';

/**
 * Single dispatch point for all outbound notifications.
 *
 * Publishers call `send()` with a typed `NotificationTarget` and content.
 * All targets are enqueued to the NOTIFICATION_BROADCAST queue — there is no
 * synchronous delivery path. For single-user delivery, pass
 * `{ type: NotificationTargetEnum.USERS, userIds: [userId] }`.
 */
@Injectable()
export class NotificationRouterService {
  constructor(private readonly notifyChannelSubscribersService: NotifyChannelSubscribersService) {}

  async send({
    channelType,
    target,
    content,
    contentByUserId,
    deliveryOverrides,
  }: {
    channelType: NotificationChannelEnum;
    target: NotificationTarget;
    content: NotificationContent;
    contentByUserId?: Record<string, PerUserContent>;
    deliveryOverrides?: DeliveryOverrides;
  }): Promise<void> {
    await this.notifyChannelSubscribersService.enqueue({
      channelType,
      target,
      content,
      contentByUserId,
      deliveryOverrides,
    });
  }
}
