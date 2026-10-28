import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { BACKGROUND_JOB_QUEUE_NAMES, JOB_TYPES } from 'src/shared/enums/background-queue.enum';
import { NotificationChannelEnum } from '../../../shared/enums/notification-channel.enum';
import { NotificationTargetEnum } from '../../../shared/enums/notification-target.enum';
import type { CreateNotificationDto } from 'src/lib/types/notification.types';
import type { NotificationContent, NotificationTarget } from '../types/notification-target.types';
import type { BroadcastJobData } from '../modules/broadcast/notification-broadcast.service';
import { ChannelRegistryService } from '../modules/channel/core/channel-registry.service';
import type { DeliveryOverrides, PerUserContent } from '../modules/channel/core/types';

/** Default fan-out chunk size when NOTIFICATION_BROADCAST_CHUNK_SIZE is not configured. Mirrors drizzle. */
const DEFAULT_BROADCAST_CHUNK_SIZE = 100;

/**
 * Enqueues a notification job for any target scope.
 *
 * Covers both single-user (`USERS` with one ID) and fan-out (`ORG`, `PLATFORM`,
 * multi-ID `USERS`). The processor handles chunked keyset pagination and per-user
 * row creation. Push opt-out is enforced in NotifyUserService, not here.
 */
@Injectable()
export class NotifyChannelSubscribersService {
  private readonly logger = new Logger(NotifyChannelSubscribersService.name);

  constructor(
    @InjectQueue(BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_BROADCAST)
    private readonly broadcastQueue: Queue,
    private readonly configService: ConfigService,
    private readonly channelRegistry: ChannelRegistryService,
  ) {}

  async enqueue({
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
    const chunkSize =
      this.configService.get<number>('NOTIFICATION_BROADCAST_CHUNK_SIZE') ??
      DEFAULT_BROADCAST_CHUNK_SIZE;
    const meta = this.channelRegistry.meta(channelType);
    const now = new Date();

    const baseDto: Omit<CreateNotificationDto, 'subscriber'> = {
      publisher: content.publisher ?? null,
      channelType,
      title: content.title ?? meta.title ?? undefined,
      messageContent: content.messageContent,
      metadata: content.metadata,
      expiresAt: new Date(now.getTime() + meta.ttlDays * 24 * 60 * 60 * 1000),
    };

    const jobData: BroadcastJobData = {
      broadcastId: randomUUID(),
      target,
      baseDto,
      chunkSize,
      contentByUserId,
      deliveryOverrides,
    };

    await this.broadcastQueue.add(
      JOB_TYPES[BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_BROADCAST].FAN_OUT,
      jobData,
    );

    const label =
      target.type === NotificationTargetEnum.USERS
        ? `users[${target.userIds.length}]`
        : target.type;
    this.logger.log(`Enqueued notification — channel=${channelType} target=${label}`);
  }
}
