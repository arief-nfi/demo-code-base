import { z } from 'zod';

export const createPartnerSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Code must be kebab-case (e.g. my-partner)'),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  contactName: z.string().max(255).optional(),
  contactEmail: z.string().email('Invalid email format').optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreatePartnerDto = z.infer<typeof createPartnerSchema>;
