import { z } from 'zod';

export const auditExportSchema = z.object({
  format: z.enum(['csv', 'json']),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  userId: z.string().optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'READ']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type AuditExportDto = z.infer<typeof auditExportSchema>;
