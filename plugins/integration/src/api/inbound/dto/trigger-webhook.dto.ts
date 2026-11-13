import { z } from 'zod';

export const triggerWebhookSchema = z.object({
  eventCode: z.string().min(1, 'Event code is required'),
  payload: z.record(z.string(), z.unknown()),
});

export type TriggerWebhookDto = z.infer<typeof triggerWebhookSchema>;
