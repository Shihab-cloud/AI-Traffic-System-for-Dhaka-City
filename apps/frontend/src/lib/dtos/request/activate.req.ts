import {
  ActivateAccountRequestValidation,
  ActivateAccountValidation,
} from '@/lib/validators/auth.validator';

import { z } from 'zod';

export type ActivateAccountRequest = z.infer<typeof ActivateAccountRequestValidation>;
export type ActivateAccountForm = z.infer<typeof ActivateAccountValidation>;
