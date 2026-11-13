import { z } from 'zod';

export const updatePartnerSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Code must be kebab-case (e.g. my-partner)')
    .optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  contactName: z.string().max(255).optional().nullable(),
  contactEmail: z.string().email('Invalid email format').optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type UpdatePartnerDto = z.infer<typeof updatePartnerSchema>;
