import { PasswordUpdateValidation, ProfileUpdateValidation } from '@/lib/validators/user.validator';

import z from 'zod';

export type ProfileUpdateRequest = z.infer<typeof ProfileUpdateValidation>;

export type PasswordUpdateRequest = z.infer<typeof PasswordUpdateValidation>;
