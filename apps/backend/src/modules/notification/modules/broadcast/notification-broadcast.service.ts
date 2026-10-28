import { Injectable } from '@nestjs/common';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { BroadcastNotificationRequest } from 'src/lib/dto/request/broadcast-notification.req';
import { NotificationChannelEnum } from '../../../../shared/enums/notification-channel.enum';
import { NotificationTargetEnum } from '../../../../shared/enums/notification-target.enum';
import { NotifyChannelSubscribersService } from '../../adapters/notify-channel-subscribers.service';
import type { CreateNotificationDto } from 'src/lib/types/notification.types';
import type { NotificationTarget } from '../../types/notification-target.types';
import type { DeliveryOverrides, PerUserContent } from '../channel/core/types';

export interface BroadcastJobData {
  /**
   * Stable id for one fan-out, carried across every chunk.
   *
   * Used to build a deterministic BullMQ `jobId` per continuation
   * (`${broadcastId}:${step}`) so a retried chunk cannot enqueue its successor
   * twice. Without it, enabling retries would turn a partial failure into
   * duplicate notifications for everyone downstream of the failing chunk.
   */
  broadcastId: string;
  target: NotificationTarget;
  baseDto: Omit<CreateNotificationDto, 'subscriber'>;
  chunkSize: number;
  /** Keyset cursor — last user `_id` returned by the previous chunk; absent on the first chunk. */
  lastId?: string;
  /** Step counter — incremented per chunk; bounded by MAX_BROADCAST_STEPS to prevent runaway jobs. */
  step?: number;
  /**
   * Optional userId → personalized content map. When set, the broadcast
   * processor merges the entry for each recipient into the dto before
   * dispatch. Recipients without an entry receive `baseDto` as-is.
   *
   * Soft cap: a single broadcast carries the entire map through the queue —
   * keep below ~50k entries; for larger fan-outs split caller-side.
   */
  contentByUserId?: Record<string, PerUserContent>;
  deliveryOverrides?: DeliveryOverrides;
}

/** Hard cap on chunks per broadcast — protects against pathological cursor loops. */
export const MAX_BROADCAST_STEPS = 10_000;

@Injectable()
export class NotificationBroadcastService {
  constructor(private readonly notifyChannelSubscribersService: NotifyChannelSubscribersService) {}

  /**
   * Fan out to all platform users. Gated by the `BROADCAST_NOTIFICATION`
   * permission on the controller.
   */
  async enqueueBroadcast(publisher: CurrentUser, dto: BroadcastNotificationRequest): Promise<void> {
    const channelType = dto.channelType ?? NotificationChannelEnum.GENERAL;
    const target: NotificationTarget = { type: NotificationTargetEnum.PLATFORM };

    await this.notifyChannelSubscribersService.enqueue({
      channelType,
      target,
      content: {
        publisher: publisher.id,
        messageContent: dto.message,
        metadata: dto.documentType
          ? { ids: [{ documentType: dto.documentType, documentId: 'broadcast' }] }
          : undefined,
      },
    });
  }
}
