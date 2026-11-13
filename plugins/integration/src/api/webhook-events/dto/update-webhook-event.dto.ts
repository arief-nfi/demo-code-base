import { z } from 'zod';

export const updateWebhookEventSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/, 'Code must be dot-notation (e.g. order.created)')
    .optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  payloadSchema: z.record(z.string(), z.unknown()).optional().nullable(),
  samplePayload: z.record(z.string(), z.unknown()).optional().nullable(),
  isActive: z.boolean().optional(),
});

export type UpdateWebhookEventDto = z.infer<typeof updateWebhookEventSchema>;
