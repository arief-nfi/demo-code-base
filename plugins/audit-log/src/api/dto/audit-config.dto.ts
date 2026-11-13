import { z } from 'zod';

const fieldConfigSchema = z.record(z.string(), z.array(z.string()));

const auditActionSchema = z.enum(['CREATE', 'UPDATE', 'DELETE', 'READ']);

const entityFilterSchema = z.object({
  mode: z.enum(['include', 'exclude']),
  entities: z.array(z.string().min(1)).default([]),
  actions: z.record(z.string(), z.array(auditActionSchema).min(1)).optional(),
}).nullable();

const retentionPolicySchema = z.object({
  enabled: z.boolean(),
  type: z.enum(['time', 'count']),
  retainDays: z.number().int().min(1).optional(),
  keepCount: z.number().int().min(1).optional(),
  backup: z.boolean(),
}).nullable();

export const auditConfigSchema = z.object({
  sensitiveFields: fieldConfigSchema.optional(),
  ignoredFields: fieldConfigSchema.optional(),
  entityFilter: entityFilterSchema.optional(),
  retentionPolicy: retentionPolicySchema.optional(),
});

export type AuditConfigDto = z.infer<typeof auditConfigSchema>;
