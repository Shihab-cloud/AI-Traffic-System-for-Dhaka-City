'use client';

import { SupportTicketLogResponse } from '@/lib/dtos/response/support.res';
import { SupportTicketLogTypeEnum } from '@/lib/enums/support.enum';
import AssignedToChangedLog from './AssignedToChangedLog';
import MessageAddedLog from './MessageAddedLog';
import PriorityChangedLog from './PriorityChangedLog';
import StatusChangedLog from './StatusChangedLog';
import TicketCreatedLog from './TicketCreatedLog';

interface Props {
  log: SupportTicketLogResponse;
}

export default function LogItem({ log }: Props) {
  const renderLogContent = () => {
    switch (log.type) {
      case SupportTicketLogTypeEnum.TICKET_CREATED:
        return <TicketCreatedLog log={log} />;
      case SupportTicketLogTypeEnum.STATUS_CHANGED:
        return <StatusChangedLog log={log} />;
      case SupportTicketLogTypeEnum.PRIORITY_CHANGED:
        return <PriorityChangedLog log={log} />;
      case SupportTicketLogTypeEnum.ASSIGNED_TO_CHANGED:
        return <AssignedToChangedLog log={log} />;
      case SupportTicketLogTypeEnum.MESSAGE_ADDED:
        return <MessageAddedLog log={log} />;
      default:
        return null;
    }
  };

  return <div className="overflow-clip">{renderLogContent()}</div>;
}
