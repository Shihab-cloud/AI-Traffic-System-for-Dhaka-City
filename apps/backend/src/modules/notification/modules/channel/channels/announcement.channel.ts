import { Injectable } from '@nestjs/common';
import { NotificationPriorityEnum } from 'src/shared/enums/notification-priority.enum';
import { NotificationChannelEnum } from 'src/shared/enums/notification-channel.enum';
import { NotificationTargetEnum } from '../../../../../shared/enums/notification-target.enum';
import { ChannelHandler, ChannelMeta, ChannelOutput, DefaultChannelPayload } from '../core/types';

@Injectable()
export class AnnouncementChannel implements ChannelHandler {
  static readonly meta: ChannelMeta = {
    type: NotificationChannelEnum.ANNOUNCEMENT,
    push: true,
    email: true,
    priority: NotificationPriorityEnum.NORMAL,
    ttlDays: 30,
    silent: false,
    title: 'Announcement',
    emailTemplate: __dirname + '/../../email/templates/announcement/system-announcement',
  };

  build(payload: DefaultChannelPayload): ChannelOutput {
    return {
      target: { type: NotificationTargetEnum.PLATFORM },
      defaultContent: {
        messageContent: payload.message ?? '',
        title: payload.title,
        metadata: payload.metadata,
      },
    };
  }
}
