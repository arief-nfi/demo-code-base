import { z } from 'zod';

export const auditRetentionSchema = z.object({
  type: z.enum(['time', 'count']),
  beforeDate: z.string().datetime({ offset: true }).optional(),
  keepCount: z.number().int().min(1).optional(),
  backup: z.boolean().optional(),
});

export type AuditRetentionDto = z.infer<typeof auditRetentionSchema>;
