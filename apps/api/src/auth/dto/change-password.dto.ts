import { z } from 'zod';

export const changePasswordSchema = z.object({
  currentPass: z.string().min(1, 'Current password is required'),
  newPass: z.string().min(8, 'New password must be at least 8 characters'),
});

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
