import { z } from 'zod';

export const createSampleItemSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  value: z.string().optional(),
});

export type CreateSampleItemDto = z.infer<typeof createSampleItemSchema>;
