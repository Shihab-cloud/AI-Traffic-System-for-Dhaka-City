import { Injectable } from '@nestjs/common';
import { NotificationChannelEnum } from '../../../../../shared/enums/notification-channel.enum';
import { NotificationTargetEnum } from '../../../../../shared/enums/notification-target.enum';
import { NotificationPriorityEnum } from '../../../../../shared/enums/notification-priority.enum';
import { ChannelHandler, ChannelMeta, ChannelOutput, DefaultChannelPayload } from '../core/types';

interface ToUserPayload extends DefaultChannelPayload {
  /** Recipient user id. */
  userId: string;
}

/**
 * Pattern B example — single recipient via `payload.userId`.
 *
 * Channel resolves the target from the payload. Caller passes intent
 * (the user) only; channel composes message text and audience.
 */
@Injectable()
export class ToUserChannel implements ChannelHandler<ToUserPayload> {
  static readonly meta: ChannelMeta = {
    type: NotificationChannelEnum.TO_USER,
    push: true,
    email: true,
    priority: NotificationPriorityEnum.LOW,
    ttlDays: 15,
    silent: false,
    title: 'Notification',
    emailTemplate: __dirname + '/../../email/templates/user/account-event',
  };

  build(payload: ToUserPayload): ChannelOutput {
    return {
      target: { type: NotificationTargetEnum.USERS, userIds: [payload.userId] },
      defaultContent: {
        messageContent: payload.message ?? 'You have a new notification',
        title: payload.title,
        metadata: payload.metadata,
      },
    };
  }
}
