import { z } from 'zod';

export const createApiKeySchema = z.object({
  partnerId: z.string().uuid('Invalid partner ID'),
  name: z.string().min(1, 'Name is required').max(255),
  scopes: z.array(z.string()).default(['*']),
  expiresAt: z.coerce.date().optional(),
});

export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;
