import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address').optional(),
});

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
