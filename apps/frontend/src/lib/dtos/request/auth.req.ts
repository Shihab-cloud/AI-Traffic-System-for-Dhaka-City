import {
  AcceptInviteValidation,
  ForgotPasswordValidation,
  ResetPasswordValidation,
  SigninValidation,
  SignupValidation,
} from '@/lib/validators/auth.validator';

import { z } from 'zod';

export type SigninRequest = z.infer<typeof SigninValidation>;

export type SignupRequest = z.infer<typeof SignupValidation>;

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordValidation>;

export type ResetPasswordRequest = z.infer<typeof ResetPasswordValidation>;

export type AcceptInviteRequest = z.infer<typeof AcceptInviteValidation>;
