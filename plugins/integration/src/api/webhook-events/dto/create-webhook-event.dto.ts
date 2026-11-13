import { z } from 'zod';

export const createWebhookEventSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(100)
    .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/, 'Code must be dot-notation (e.g. order.created)'),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  payloadSchema: z.record(z.string(), z.unknown()).optional(),
  samplePayload: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type CreateWebhookEventDto = z.infer<typeof createWebhookEventSchema>;
