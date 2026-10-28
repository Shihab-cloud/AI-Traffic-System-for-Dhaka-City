import {
  SupportTicketCategoryEnum,
  SupportTicketLogTypeEnum,
  SupportTicketPriorityEnum,
  SupportTicketStatusEnum,
} from '@/lib/enums/support.enum';
import { SupportTicketLogDetails } from '@/lib/types/support.types';

export interface SupportMessageFileResponse {
  fileName: string;
  url: string;
}

export interface SupportFileUploadUrlResponse {
  presignedUrl: string;
  key: string;
}

export interface SupportUploadConfirmResponse {
  fileKey: string;
  fileName: string;
}

export interface SupportTicketLogPerformerResponse {
  id: string;
  name: string;
  role: string | null;
}

export interface SupportTicketLogResponse {
  id: string;
  type: SupportTicketLogTypeEnum;
  message: string | null;
  details: SupportTicketLogDetails | null;
  createdAt: string;
  performedBy: SupportTicketLogPerformerResponse | null;
  attachments: SupportMessageFileResponse[];
}

export interface SupportTicketResponse extends BaseResponse {
  ticketNumber: string;
  submittedById: string;
  submittedByName: string;
  submittedByRole: string;
  category: SupportTicketCategoryEnum;
  priority: SupportTicketPriorityEnum;
  status: SupportTicketStatusEnum;
  subject: string;
  description: string;
  assignedTo: string;
  lastResponseAt: string | null;
  resolvedAt: string | null;
}

export interface SupportTicketDetailResponse extends SupportTicketResponse {
  logs: SupportTicketLogResponse[];
}
