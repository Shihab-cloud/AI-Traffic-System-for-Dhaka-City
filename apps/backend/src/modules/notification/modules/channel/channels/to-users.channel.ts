import { Injectable } from '@nestjs/common';
import { NotificationChannelEnum } from '../../../../../shared/enums/notification-channel.enum';
import { NotificationTargetEnum } from '../../../../../shared/enums/notification-target.enum';
import { NotificationPriorityEnum } from '../../../../../shared/enums/notification-priority.enum';
import {
  ChannelHandler,
  ChannelMeta,
  ChannelOutput,
  DefaultChannelPayload,
  PerUserContent,
} from '../core/types';

interface ToUsersPayload extends DefaultChannelPayload {
  /** Caller-built userId → content map. Channel resolves recipients from keys and forwards. */
  contentByUserId: Record<string, PerUserContent>;
}

/**
 * Pattern C example — personalized fan-out to N recipients in a single publish.
 *
 * Caller pre-computes per-recipient content (e.g. a billing service has each
 * recipient's amount already). Channel forwards the map; per-user delivery
 * picks `contentByUserId[userId]` for each recipient.
 */
@Injectable()
export class ToUsersChannel implements ChannelHandler<ToUsersPayload> {
  static readonly meta: ChannelMeta = {
    type: NotificationChannelEnum.TO_USERS,
    push: true,
    email: true,
    priority: NotificationPriorityEnum.NORMAL,
    ttlDays: 30,
    silent: false,
    title: 'Notification',
  };

  build(payload: ToUsersPayload): ChannelOutput {
    return {
      target: {
        type: NotificationTargetEnum.USERS,
        userIds: Object.keys(payload.contentByUserId),
      },
      defaultContent: {
        messageContent: payload.message ?? 'You have a new notification',
        title: payload.title,
      },
      contentByUserId: payload.contentByUserId,
    };
  }
}
