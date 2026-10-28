import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryOverrides } from '../modules/channel/core/types';
import { ChannelRegistryService } from '../modules/channel/core/channel-registry.service';
import type {
  CreateNotificationDto,
  NotificationDeliveryDto,
  ResolvedPrefs,
} from 'src/lib/types/notification.types';
import {
  DeliveryChannelEnum,
  DeliveryLogStatusEnum,
} from 'src/shared/enums/notification-delivery-status.enum';
import { NotificationPriorityEnum } from 'src/shared/enums/notification-priority.enum';
import type { DeliveryLogEntry } from 'src/lib/types/notification.types';
import { UserNotificationSettingsService } from '../modules/user-notification-settings/user-notification-settings.service';
import { EmailDeliveryService } from './delivery/email-delivery.service';
import { PushDeliveryService } from './delivery/push-delivery.service';
import { NotificationDbService } from './notification.db.service';
import type { Notification } from 'src/schemas/notification/notification.schema';

type ResolvedDeliveryPrefs = ResolvedPrefs & { deferUntil?: Date };

@Injectable()
export class NotifyUserService {
  private readonly logger = new Logger(NotifyUserService.name);

  constructor(
    private readonly notificationDbService: NotificationDbService,
    private readonly userSettingsService: UserNotificationSettingsService,
    private readonly pushDelivery: PushDeliveryService,
    private readonly emailDelivery: EmailDeliveryService,
    private readonly channelRegistry: ChannelRegistryService,
  ) {}

  /**
   * Persists a notification and delivers it across all enabled channels.
   *
   * Delivery flow:
   * 1. Persist — deliveryLogs starts as [].
   * 2. Resolve user preferences. Defer if inside quiet hours (unless CRITICAL bypass).
   * 3. Run FCM delivery if push is enabled — appends FCM log entry.
   * 4. Run email delivery (proactive) if emailEnabled is true — appends EMAIL log entry.
   * 5. Run email as fallback if emailFallback is on and FCM failed and priority is CRITICAL.
   *    Each transport appends its own log entry.
   */
  async notifyUser(
    dto: CreateNotificationDto,
    deliveryOverrides?: DeliveryOverrides,
  ): Promise<void> {
    const row = await this.notificationDbService.create(dto);
    const deliveryDto = this.buildDeliveryDto(row);

    const resolved = await this.userSettingsService.resolve(dto.subscriber, dto.channelType);

    if (deliveryOverrides?.push !== undefined) resolved.push = deliveryOverrides.push;
    if (deliveryOverrides?.email !== undefined) resolved.emailEnabled = deliveryOverrides.email;

    if (await this.deferIfInQuietHours(deliveryDto.id, dto, resolved)) return;

    const pushStatus = await this.dispatchPushDelivery(deliveryDto.id, deliveryDto, resolved);
    const emailSent = await this.dispatchEmailDelivery(deliveryDto.id, deliveryDto, resolved);
    await this.dispatchEmailFallback(deliveryDto.id, deliveryDto, resolved, pushStatus, emailSent);
  }

  private buildDeliveryDto(row: Notification): NotificationDeliveryDto {
    return {
      id: String(row._id),
      userId: String(row.subscriber),
      channelType: row.channelType,
      title: row.title,
      messageContent: row.messageContent,
      metadata: row.metadata,
    };
  }

  /**
   * If quiet hours apply, appends a DEFERRED log entry and enqueues a retry.
   * @returns true when deferred — caller must stop further processing.
   */
  private async deferIfInQuietHours(
    rowId: string,
    dto: CreateNotificationDto,
    resolved: ResolvedDeliveryPrefs,
  ): Promise<boolean> {
    if (!resolved.deferred || !resolved.deferUntil) return false;
    const now = new Date().toISOString();
    const entry: DeliveryLogEntry = {
      channel: DeliveryChannelEnum.ALL,
      status: DeliveryLogStatusEnum.DEFERRED,
      triedAt: now,
      sentAt: null,
      deferredAt: resolved.deferUntil.toISOString(),
      failedAt: null,
    };
    await this.notificationDbService.appendDeliveryLog(rowId, entry);
    await this.userSettingsService.enqueueDeferred(resolved.deferUntil, dto);
    return true;
  }

  /**
   * Runs push delivery (FCM web push) when push is enabled. Appends a log entry
   * on any real attempt. Returns the delivery status for the fallback guard, or
   * undefined when skipped.
   */
  private async dispatchPushDelivery(
    rowId: string,
    deliveryDto: NotificationDeliveryDto,
    prefs: ResolvedPrefs,
  ): Promise<DeliveryLogStatusEnum | undefined> {
    if (!this.pushDelivery.isEnabled(deliveryDto, prefs)) return undefined;

    try {
      const entry = await this.pushDelivery.deliver(deliveryDto);
      if (entry) await this.notificationDbService.appendDeliveryLog(rowId, entry);
      return entry?.status;
    } catch (err) {
      this.logger.error(`Push delivery failed for notification ${rowId}: ${err}`);
      return undefined;
    }
  }

  /**
   * Runs proactive email delivery when emailEnabled is set. Appends a log entry.
   * Returns true when the step ran (success or failure) to suppress duplicate fallback send.
   */
  private async dispatchEmailDelivery(
    rowId: string,
    deliveryDto: NotificationDeliveryDto,
    prefs: ResolvedPrefs,
  ): Promise<boolean> {
    if (!this.emailDelivery.isEnabled(deliveryDto, prefs)) return false;

    try {
      const entry = await this.emailDelivery.deliver(deliveryDto);
      if (entry) await this.notificationDbService.appendDeliveryLog(rowId, entry);
      return true;
    } catch (err) {
      this.logger.error(`Email delivery failed for notification ${rowId}: ${err}`);
      return false;
    }
  }

  /**
   * Last-resort email send when push failed for a CRITICAL notification and proactive
   * email did not already run. Appends its own log entry.
   */
  private async dispatchEmailFallback(
    rowId: string,
    deliveryDto: NotificationDeliveryDto,
    prefs: ResolvedPrefs,
    pushStatus: DeliveryLogStatusEnum | undefined,
    emailAlreadySent: boolean,
  ): Promise<void> {
    if (
      emailAlreadySent ||
      !prefs.emailFallback ||
      pushStatus !== DeliveryLogStatusEnum.FAILED ||
      this.channelRegistry.meta(deliveryDto.channelType).priority !==
        NotificationPriorityEnum.CRITICAL
    ) {
      return;
    }

    try {
      const entry = await this.emailDelivery.deliver(deliveryDto);
      if (entry) await this.notificationDbService.appendDeliveryLog(rowId, entry);
    } catch (err) {
      this.logger.error(`Email fallback failed for notification ${rowId}: ${err}`);
    }
  }
}
