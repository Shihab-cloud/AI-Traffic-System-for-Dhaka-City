import { Injectable } from '@nestjs/common';
import { NotificationChannelEnum } from '../../../../../shared/enums/notification-channel.enum';
import { NotificationTargetEnum } from '../../../../../shared/enums/notification-target.enum';
import { NotificationPriorityEnum } from '../../../../../shared/enums/notification-priority.enum';
import { DocumentType } from '../../../../../shared/enums/document-type.enum';
import { ChannelHandler, ChannelMeta, ChannelOutput, DefaultChannelPayload } from '../core/types';

interface SupportTicketNotifyPayload extends DefaultChannelPayload {
  ticket: { id: string };
  message: string;
  userIds: string[];
}

@Injectable()
export class SupportTicketNotifyChannel implements ChannelHandler<SupportTicketNotifyPayload> {
  static readonly meta: ChannelMeta = {
    type: NotificationChannelEnum.SUPPORT_TICKET_NOTIFY,
    push: true,
    email: false,
    priority: NotificationPriorityEnum.NORMAL,
    ttlDays: 30,
    silent: false,
    title: 'Support ticket update',
  };

  build(payload: SupportTicketNotifyPayload): ChannelOutput {
    return {
      target: { type: NotificationTargetEnum.USERS, userIds: payload.userIds },
      defaultContent: {
        title: payload.title ?? SupportTicketNotifyChannel.meta.title,
        messageContent: payload.message,
        metadata: {
          ids: [{ documentType: DocumentType.SUPPORT_TICKET, documentId: payload.ticket.id }],
        },
      },
    };
  }
}
