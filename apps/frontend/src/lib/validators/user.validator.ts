import { z } from 'zod';

export const UserCreationValidation = z
  .object({
    firstName: z.string().trim().min(1, { message: 'First name is required.' }),
    lastName: z.string().trim().min(1, { message: 'Last name is required.' }),
    email: z.string().trim().email({ message: 'Invalid email.' }).or(z.literal('')).optional(),
    phone: z.string().nullish(),
    gender: z.string().nullable().nullish(),
    dateOfBirth: z.string().nullish(),
    profileImage: z.string().nullish(),
    additionalInfo: z.string().nullish(),
    roleId: z
      .string({ message: 'Please select a role' })
      .min(1, { message: 'Please select a role' }),
    sendInvite: z.boolean(),
    sendWelcomeEmail: z.boolean().optional(),
    password: z.string().trim().nullish(),
    confirmPassword: z.string().nullish(),
    username: z
      .string()
      .trim()
      .min(3, { message: 'Username must be at least 3 characters.' })
      .max(30, { message: 'Username must be at most 30 characters.' })
      .regex(/^[a-zA-Z0-9_.-]+$/, {
        message: 'Username may contain letters, numbers, underscore, dot, hyphen.',
      })
      .optional()
      .or(z.literal('')),
  })
  .superRefine((data, ctx) => {
    // At least one of email or username is required (backend CHECK constraint).
    if (!data.email && !data.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either an email or a username.',
        path: ['email'],
      });
    }
    // Email-based invite requires an email. With username only, set a password instead.
    if (data.sendInvite && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invite emails need an email address. Set a password instead.',
        path: ['email'],
      });
    }
    if (!data.sendInvite) {
      if (!data.password || data.password.length < 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Password must be at least 6 characters long.',
          path: ['password'],
        });
      }
      if (data.password !== data.confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Passwords do not match.',
          path: ['confirmPassword'],
        });
      }
    }
  });

export const UserUpdateValidation = z.object({
  firstName: z.string().trim().min(1, { message: 'First name is required.' }),
  lastName: z.string().trim().min(1, { message: 'Last name is required.' }),
  email: z.string().email({ message: 'Invalid email.' }),
  phone: z.string().nullish(),
  gender: z.string().nullable().nullish(),
  dateOfBirth: z.string().nullish(),
  profileImage: z.string().nullish(),
  additionalInfo: z.string().nullish(),
  roleId: z.string({ message: 'Please select a role' }).min(1, { message: 'Please select a role' }),
  username: z
    .string()
    .trim()
    .min(3, { message: 'Username must be at least 3 characters.' })
    .max(30, { message: 'Username must be at most 30 characters.' })
    .regex(/^[a-zA-Z0-9_.-]+$/, {
      message: 'Username may contain letters, numbers, underscore, dot, hyphen.',
    })
    .optional()
    .or(z.literal('')),
});

export const ProfileUpdateValidation = z.object({
  firstName: z.string().trim().min(1, { message: 'First name is required.' }),
  lastName: z.string().trim().min(1, { message: 'Last name is required.' }),
  email: z.string().email({ message: 'Invalid email.' }),
  phone: z.string().nullish(),
  gender: z.string().nullish(),
  dateOfBirth: z.string().nullish(),
  profileImage: z.string().nullish(),
  additionalInfo: z.string().nullish(),
});

export const PasswordUpdateValidation = z
  .object({
    oldPassword: z
      .string()
      .trim()
      .min(6, { message: 'Invalid password' })
      .optional()
      .or(z.literal('')),
    newPassword: z
      .string()
      .trim()
      .min(6, { message: 'New password must be at least 6 characters long.' }),
    confirmNewPassword: z
      .string()
      .trim()
      .min(1, {
        message: 'Please confirm your new password.',
      })
      .transform((val) => val.trim()),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'Passwords do not match.',
    path: ['confirmNewPassword'],
  });
