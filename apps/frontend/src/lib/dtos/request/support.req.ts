import { SupportTicketPriorityEnum, SupportTicketStatusEnum } from '@/lib/enums/support.enum';
import {
  CompleteSupportUploadValidation,
  GetSupportPresignedUrlValidation,
  MessageAttachmentValidation,
  TicketCreateValidation,
  TicketReplyValidation,
} from '@/lib/validators/support-ticket.validator';
import { z } from 'zod';

export type MessageAttachmentRequest = z.infer<typeof MessageAttachmentValidation>;
export type CreateTicketRequest = z.infer<typeof TicketCreateValidation>;
export type CreateMessageRequest = z.infer<typeof TicketReplyValidation>;
export type GetSupportPresignedUrlRequest = z.infer<typeof GetSupportPresignedUrlValidation>;
export type CompleteSupportUploadRequest = z.infer<typeof CompleteSupportUploadValidation>;

export interface UpdateTicketRequest {
  status?: SupportTicketStatusEnum;
  priority?: SupportTicketPriorityEnum;
  assignedTo?: string;
}
