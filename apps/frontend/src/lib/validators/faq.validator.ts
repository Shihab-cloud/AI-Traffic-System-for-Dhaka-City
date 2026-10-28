import { FaqAudienceEnum } from '@/lib/enums/faq.enum';
import { z } from 'zod';

export const FaqCreateValidation = z.object({
  question: z
    .string()
    .trim()
    .min(1, { message: 'Question is required.' })
    .max(500, { message: 'Question must be 500 characters or fewer.' }),
  answer: z
    .string()
    .trim()
    .min(1, { message: 'Answer is required.' })
    .max(10000, { message: 'Answer must be 10,000 characters or fewer.' }),
  category: z.string().trim().max(100).optional(),
  audience: z.array(z.nativeEnum(FaqAudienceEnum)).optional(),
  isPublished: z.boolean().optional(),
});

export const FaqUpdateValidation = FaqCreateValidation.partial();

const FaqReorderItemValidation = z.object({
  id: z.string().uuid(),
  displayOrder: z.number().int().min(0),
});

export const FaqsReorderItemsValidation = z.object({
  faqItems: z.array(FaqReorderItemValidation),
});
