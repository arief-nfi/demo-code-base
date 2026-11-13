import { z } from 'zod';

export const auditRetentionPolicySchema = z.object({
  enabled: z.boolean(),
  type: z.enum(['time', 'count']),
  retainDays: z.number().int().min(1).optional(),
  keepCount: z.number().int().min(1).optional(),
  backup: z.boolean(),
});

export type AuditRetentionPolicyDto = z.infer<typeof auditRetentionPolicySchema>;
