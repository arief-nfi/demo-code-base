import { z } from 'zod';

const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  backoffMs: z.number().int().min(100).max(60000),
  backoffMultiplier: z.number().min(1).max(5),
});

export const updateWebhookSchema = z.object({
  url: z.string().url('Invalid URL').optional(),
  description: z.string().max(1000).optional().nullable(),
  headers: z.record(z.string(), z.string()).optional().nullable(),
  isActive: z.boolean().optional(),
  retryPolicy: retryPolicySchema.optional().nullable(),
});

export type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;
