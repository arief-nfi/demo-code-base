import { z } from 'zod';

export const auditVerifySchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});

export type AuditVerifyDto = z.infer<typeof auditVerifySchema>;
