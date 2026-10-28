import { z } from 'zod';

export const RoleCreationValidation = z.object({
  name: z.string().trim().min(1, { message: 'Role name is required.' }),
  description: z.string().nullish(),
  permissions: z.array(z.string()).min(1, { message: 'Please select at least one permission.' }),
  rank: z
    .number()
    .int({ message: 'Rank must be a whole number.' })
    .min(0, { message: 'Rank must be 0 or greater.' }),
});
