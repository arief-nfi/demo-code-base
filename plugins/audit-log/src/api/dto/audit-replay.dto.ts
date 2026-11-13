import { z } from 'zod';

export const auditReplaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  dryRun: z.boolean().optional(),
});

export type AuditReplayDto = z.infer<typeof auditReplaySchema>;
