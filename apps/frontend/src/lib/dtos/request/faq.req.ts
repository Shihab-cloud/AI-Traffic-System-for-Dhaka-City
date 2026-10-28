import {
  FaqCreateValidation,
  FaqsReorderItemsValidation,
  FaqUpdateValidation,
} from '@/lib/validators/faq.validator';
import { z } from 'zod';

export type CreateFaqRequest = z.infer<typeof FaqCreateValidation>;
export type UpdateFaqRequest = z.infer<typeof FaqUpdateValidation>;
export type FaqsReorderItemsRequest = z.infer<typeof FaqsReorderItemsValidation>;
