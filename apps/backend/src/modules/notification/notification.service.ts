import { Injectable } from '@nestjs/common';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { BroadcastNotificationRequest } from 'src/lib/dto/request/broadcast-notification.req';
import { RegisterDeviceTokenRequest } from 'src/lib/dto/request/register-device-token.req';
import { UpdateGlobalNotificationSettingsRequest } from 'src/lib/dto/request/update-notification-settings.req';
import type { PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { NotificationRouterService } from './adapters/notification-router.service';
import { NotificationDbService } from './adapters/notification.db.service';
import { NotificationBroadcastService } from './modules/broadcast/notification-broadcast.service';
import { ChannelRegistryService } from './modules/channel/core/channel-registry.service';
import type { ChannelKey, PayloadByChannel } from './modules/channel/core/registry';
import type { ChannelHandler, PublishOverrides } from './modules/channel/core/types';
import { DeviceTokenService } from './modules/fcm/device-token.service';
import { UserNotificationSettingsService } from './modules/user-notification-settings/user-notification-settings.service';

/**
 * Type-safe entry point for all domain notification events.
 *
 * Caller picks `channel: 'X'` (a key from the `CHANNELS` registry) and
 * `payload` is narrowed to that channel's expected shape via
 * `PayloadByChannel[K]`. Wrong shape = compile error.
 *
 * Per-call `overrides` flip delivery flags, priority, title, or target without
 * editing the channel file.
 *
 * Resolves once the dispatch is enqueued — does NOT mean the user received it.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly registry: ChannelRegistryService,
    private readonly router: NotificationRouterService,
    private readonly notificationDbService: NotificationDbService,
    private readonly deviceTokenService: DeviceTokenService,
    private readonly broadcastService: NotificationBroadcastService,
    private readonly userNotificationSettingsService: UserNotificationSettingsService,
  ) {}

  /**
   * Publish a notification on a registered channel.
   *
   * @param input.channel  Channel key from `CHANNELS` registry (e.g.
   *                       `NotificationChannelEnum.ABC`). Determines which
   *                       handler runs and narrows `payload` to its expected
   *                       shape.
   * @param input.payload  Channel-specific data the handler's `build()` reads
   *                       to compute target + message content. Shape is
   *                       defined per-channel in its `*.channel.ts` file.
   * @param input.overrides Optional per-call overrides. `target` replaces the
   *                       channel-default audience; `title` replaces the
   *                       channel-default title. `push`/`email` override the
   *                       channel default and user preferences for this call;
   *                       `priority` is accepted for forward-compatibility.
   */
  async publishNotification<K extends ChannelKey>({
    channel,
    payload,
    overrides,
  }: {
    channel: K;
    payload: PayloadByChannel[K];
    overrides?: PublishOverrides;
  }): Promise<void> {
    const { instance, meta } = this.registry.get(channel);
    const output = await (instance as ChannelHandler<PayloadByChannel[K]>).build(payload);

    const target = overrides?.target ?? output.target;
    const title = overrides?.title ?? output.defaultContent.title ?? meta.title;

    await this.router.send({
      channelType: meta.type,
      target,
      content: {
        ...output.defaultContent,
        title,
        publisher: output.publisher,
      },
      contentByUserId: output.contentByUserId,
      deliveryOverrides: overrides
        ? { push: overrides.push, email: overrides.email, priority: overrides.priority }
        : undefined,
    });
  }

  // region Controller wrappers

  listInbox(userId: string, query: PaginationQueryDto) {
    return this.notificationDbService.findForUser(userId, query);
  }

  countUnread(userId: string) {
    return this.notificationDbService.countUnread(userId);
  }

  markRead(id: string, userId: string) {
    return this.notificationDbService.markRead(id, userId);
  }

  markAllRead(userId: string) {
    return this.notificationDbService.markAllRead(userId);
  }

  registerDeviceToken(userId: string, dto: RegisterDeviceTokenRequest) {
    return this.deviceTokenService.register(userId, dto);
  }

  unregisterDeviceToken(token: string, userId: string) {
    return this.deviceTokenService.unregister(token, userId);
  }

  enqueueBroadcast(publisher: CurrentUser, dto: BroadcastNotificationRequest) {
    return this.broadcastService.enqueueBroadcast(publisher, dto);
  }

  getSettings(userId: string) {
    return this.userNotificationSettingsService.getOrCreateSettings(userId);
  }

  updateSettings(userId: string, dto: UpdateGlobalNotificationSettingsRequest) {
    return this.userNotificationSettingsService.updateSettings(userId, dto);
  }

  listChannelPreferences(userId: string) {
    return this.userNotificationSettingsService.listChannelPreferences(userId);
  }
}
