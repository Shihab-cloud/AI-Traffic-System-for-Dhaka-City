import { UserCreationValidation, UserUpdateValidation } from '@/lib/validators/user.validator';

import z from 'zod';

export type UserCreateRequest = z.infer<typeof UserCreationValidation>;

export type UserUpdateRequest = z.infer<typeof UserUpdateValidation>;

export type CreateUserPayload = Omit<UserCreateRequest, 'sendInvite' | 'confirmPassword'>;
