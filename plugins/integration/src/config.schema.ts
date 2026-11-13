import { z } from 'zod';

export const integrationConfigSchema = z.object({
  webhookTimeoutMs: z.number().min(1000).max(30000).default(10000),
  maxApiKeysPerPartner: z.number().min(1).max(100).default(10),
  deliveryRetentionDays: z.number().min(1).max(365).default(30),
  // Switched on by an admin on the Google Calendar page
  googleCalendar: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  // Switched on by an admin on the Google page; defaultAccess applies when a caller doesn't choose
  googleMeet: z
    .object({
      enabled: z.boolean().default(false),
      defaultAccess: z.enum(['TRUSTED', 'OPEN', 'RESTRICTED']).default('TRUSTED'),
    })
    .default({ enabled: false, defaultAccess: 'TRUSTED' }),
});

export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;
