import { z } from 'zod';

export const deliveryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'RETRYING']).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type DeliveryQueryDto = z.infer<typeof deliveryQuerySchema>;
