import { z } from 'zod';

export const updateApiKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.coerce.date().optional().nullable(),
});

export type UpdateApiKeyDto = z.infer<typeof updateApiKeySchema>;
