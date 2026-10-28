'use client';

import { SupportTicketDetailResponse } from '@/lib/dtos/response/support.res';
import {
  SupportTicketLogTypeEnum,
  SupportTicketPriorityEnum,
  SupportTicketStatusEnum,
} from '@/lib/enums/support.enum';
import SupportTicketTimeline from './support-logs/SupportTicketTimeline';
import TicketConversation from './TicketConversation';
import TicketInfoCard from './TicketInfoCard';
import TicketReplyForm from './TicketReplyForm';

interface TicketDetailViewProps {
  ticket: SupportTicketDetailResponse;
  onReply?: (content: string, attachments?: { fileKey: string; fileName: string }[]) => void;
  onStatusUpdate?: (status: SupportTicketStatusEnum) => void;
  onUpdateAssignedTo?: (assignedTo: string) => void;
  onUpdatePriority?: (priority: SupportTicketPriorityEnum) => void;
  canReply?: boolean;
  canUpdateStatus?: boolean;
  canAssign?: boolean;
  canChangePriority?: boolean;
  replyLoading?: boolean;
}

export default function TicketDetailView({
  ticket,
  onReply,
  onStatusUpdate,
  onUpdateAssignedTo,
  onUpdatePriority,
  canReply = false,
  canUpdateStatus = false,
  canAssign = false,
  canChangePriority = false,
  replyLoading,
}: TicketDetailViewProps) {
  const allLogs = ticket.logs ?? [];
  const messages = allLogs.filter((l) => l.type === SupportTicketLogTypeEnum.MESSAGE_ADDED);
  const activityLogs = allLogs.filter((l) => l.type !== SupportTicketLogTypeEnum.MESSAGE_ADDED);
  const creationAttachments =
    allLogs.find((l) => l.type === SupportTicketLogTypeEnum.TICKET_CREATED)?.attachments ?? [];

  return (
    <div className="flex flex-col gap-6">
      <TicketInfoCard
        ticket={ticket}
        creationAttachments={creationAttachments}
        canUpdateStatus={canUpdateStatus}
        onStatusUpdate={onStatusUpdate}
        canChangePriority={canChangePriority}
        onUpdatePriority={onUpdatePriority}
        canAssign={canAssign}
        onUpdateAssignedTo={onUpdateAssignedTo}
      />

      <TicketConversation messages={messages} />

      {canReply && onReply && <TicketReplyForm onReply={onReply} loading={replyLoading} />}

      {activityLogs.length > 0 && <SupportTicketTimeline logs={activityLogs} />}
    </div>
  );
}
