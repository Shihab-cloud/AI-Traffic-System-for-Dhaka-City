import { z } from 'zod';

export const MessageAttachmentValidation = z.object({
  fileKey: z.string(),
  fileName: z.string(),
});

export const TicketCreateValidation = z.object({
  subject: z.string().trim().min(1, { message: 'Subject is required.' }),
  description: z
    .string()
    .trim()
    .min(10, { message: 'Description must be at least 10 characters.' }),
  category: z.enum(['ACCOUNT_ACCESS', 'BILLING', 'TECHNICAL', 'GENERAL', 'OTHER']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  attachments: z.array(MessageAttachmentValidation).optional(),
});

export const GetSupportPresignedUrlValidation = z.object({
  fileName: z.string(),
  mimeType: z.string(),
});

export const CompleteSupportUploadValidation = z.object({
  fileKey: z.string(),
  fileName: z.string(),
});

export const TicketReplyValidation = z
  .object({
    content: z.string().trim().optional(),
    attachments: z.array(MessageAttachmentValidation).optional(),
  })
  .refine((data) => !!data.content || (data.attachments && data.attachments.length > 0), {
    message: 'Reply must have a message or an attachment.',
    path: ['content'],
  });
