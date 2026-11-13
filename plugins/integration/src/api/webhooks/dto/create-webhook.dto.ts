import { z } from 'zod';

const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  backoffMs: z.number().int().min(100).max(60000).default(1000),
  backoffMultiplier: z.number().min(1).max(5).default(2),
});

export const createWebhookSchema = z.object({
  partnerId: z.string().uuid('Invalid partner ID'),
  eventId: z.string().uuid('Invalid event ID'),
  url: z.string().url('Invalid URL'),
  description: z.string().max(1000).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  retryPolicy: retryPolicySchema.optional(),
});

export type CreateWebhookDto = z.infer<typeof createWebhookSchema>;
