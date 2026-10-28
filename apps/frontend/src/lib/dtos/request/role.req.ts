import { RoleCreationValidation } from '@/lib/validators/rbac.validator';
import { z } from 'zod';

export type RoleCreationRequest = z.infer<typeof RoleCreationValidation>;
