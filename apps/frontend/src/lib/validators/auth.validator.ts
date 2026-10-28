import { z } from 'zod';

import { MfaFactorTypeEnum } from '@/lib/enums/mfa.enum';
import { mfaCodeField } from '@/lib/validators/mfa.validator';

// Accepts either an email or a username. Username rule mirrors the backend
// regex on user-management.req.ts.
export const SigninValidation = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, { message: 'Email or username is required.' })
    .refine(
      (v) =>
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ||
        (/^[a-zA-Z0-9_.-]+$/.test(v) && v.length >= 3 && v.length <= 30),
      { message: 'Enter a valid email or username (3–30 chars, letters/numbers/._-).' },
    ),
  // Sign-in only checks that something was typed: length rules belong to setting a password (the demo accounts use
  // short ones: admin / officer / user).
  password: z.string().trim().min(1, { message: 'Password is required.' }),
});

export const ActivateAccountRequestValidation = z.object({
  newPassword: z
    .string()
    .trim()
    .min(8, { message: 'Password must be at least 8 characters long.' }),
  email: z.email({ message: 'Invalid email.' }).trim(),
});

export const ActivateAccountValidation = ActivateAccountRequestValidation.extend({
  confirmPassword: z.string().nullish(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

export const SignupValidation = z
  .object({
    firstName: z.string().trim().min(1, { message: 'First name is required.' }),
    lastName: z.string().trim().min(1, { message: 'Last name is required.' }),
    email: z.email({ message: 'Invalid email.' }).trim(),
    password: z.string().trim().min(6, { message: 'Password must be at least 6 characters long.' }),
    confirmPassword: z.string().nullish(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
export const ForgotPasswordValidation = z.object({
  email: z.email({ message: 'Invalid email.' }).trim(),
});

export const ResetPasswordValidation = z
  .object({
    newPassword: z
      .string()
      .trim()
      .min(6, { message: 'Password must be at least 6 characters long.' }),
    confirmPassword: z.string().nullish(),
    token: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const MfaChallengeValidation = z.object({
  factorType: z.nativeEnum(MfaFactorTypeEnum, {
    message: 'Choose a verification method.',
  }),
  code: mfaCodeField,
  /** "Remember this device for 30 days" — see `VerifyLoginChallengeValidation`. */
  rememberDevice: z.boolean().optional(),
});

export type MfaChallengeForm = z.infer<typeof MfaChallengeValidation>;

export const AcceptInviteValidation = z
  .object({
    newPassword: z
      .string()
      .trim()
      .min(6, { message: 'Password must be at least 6 characters long.' }),
    confirmPassword: z.string().nullish(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
