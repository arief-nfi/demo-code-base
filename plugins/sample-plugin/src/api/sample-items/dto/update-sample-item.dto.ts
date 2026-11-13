import { z } from 'zod';

export const updateSampleItemSchema = z.object({
  name: z.string().min(1).optional(),
  value: z.string().optional(),
});

export type UpdateSampleItemDto = z.infer<typeof updateSampleItemSchema>;
