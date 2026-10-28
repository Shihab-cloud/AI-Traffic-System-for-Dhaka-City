import { SupportTicketLogTypeEnum } from 'src/shared/enums/support.enum';

export type SupportTicketLogDetailsMap = {
  [SupportTicketLogTypeEnum.TICKET_CREATED]: {
    subject: string;
    category: string;
    priority: string;
  };
  [SupportTicketLogTypeEnum.STATUS_CHANGED]: {
    oldStatus: string;
    newStatus: string;
  };
  [SupportTicketLogTypeEnum.PRIORITY_CHANGED]: {
    oldPriority: string;
    newPriority: string;
  };
  [SupportTicketLogTypeEnum.ASSIGNED_TO_CHANGED]: {
    oldAssignedTo: string | null;
    newAssignedTo: string;
  };
  [SupportTicketLogTypeEnum.MESSAGE_ADDED]: {
    content: string;
  };
};

export type SupportTicketLogDetails = SupportTicketLogDetailsMap[keyof SupportTicketLogDetailsMap];

export type SupportTicketLogAttachment = {
  fileKey: string;
  fileName: string;
};
