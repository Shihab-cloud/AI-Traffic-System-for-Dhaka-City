import { Injectable } from '@nestjs/common';
import { NotificationChannelEnum } from '../../../../../shared/enums/notification-channel.enum';
import { NotificationTargetEnum } from '../../../../../shared/enums/notification-target.enum';
import { NotificationPriorityEnum } from '../../../../../shared/enums/notification-priority.enum';
import { ChannelHandler, ChannelMeta, ChannelOutput, DefaultChannelPayload } from '../core/types';

@Injectable()
export class GeneralChannel implements ChannelHandler {
  static readonly meta: ChannelMeta = {
    type: NotificationChannelEnum.GENERAL,
    push: true,
    email: true,
    priority: NotificationPriorityEnum.LOW,
    ttlDays: 15,
    silent: false,
    title: 'Notification',
    emailTemplate: __dirname + '/../../email/templates/welcome/welcome-template',
  };

  build(payload: DefaultChannelPayload): ChannelOutput {
    return {
      target: { type: NotificationTargetEnum.PLATFORM },
      defaultContent: {
        messageContent: payload.message ?? 'Welcome to the platform!',
        title: payload.title,
        metadata: payload.metadata,
      },
    };
  }
}
