import { z } from 'zod';

import { DocumentType } from '@/lib/enums/document-type.enum';

/** Exported so the composer's character counter cannot drift from the rule it counts against. */
export const BROADCAST_MESSAGE_MAX_LENGTH = 1000;

export const BroadcastNotificationValidation = z.object({
  message: z
    .string()
    .trim()
    .min(1, { message: 'Message is required.' })
    .max(BROADCAST_MESSAGE_MAX_LENGTH, {
      message: `Message must be ${BROADCAST_MESSAGE_MAX_LENGTH} characters or fewer.`,
    }),
  channelType: z.string().optional(),
  // The enum itself, not a copy of its values — a new document type reaches this
  // automatically instead of being rejected by a stale string union.
  documentType: z.enum(DocumentType).optional(),
});
