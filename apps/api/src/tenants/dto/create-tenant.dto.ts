import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z.string().min(1, 'Tenant name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9_-]+$/, 'Slug must contain only lowercase letters, numbers, hyphens, and underscores'),
  adminEmail: z.string().email('Invalid email address').optional(),
  adminUsername: z.string().optional(),
  adminName: z.string().optional(),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters').optional(),
});

export type CreateTenantDto = z.infer<typeof createTenantSchema>;
