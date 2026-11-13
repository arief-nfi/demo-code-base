import { z } from 'zod';

export const registerTenantSchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  slug: z.string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9_-]+$/, 'Slug must contain only lowercase letters, numbers, hyphens, and underscores'),
  adminName: z.string().min(1, 'Name is required'),
  adminEmail: z.string().email('Valid email is required'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type RegisterTenantDto = z.infer<typeof registerTenantSchema>;
