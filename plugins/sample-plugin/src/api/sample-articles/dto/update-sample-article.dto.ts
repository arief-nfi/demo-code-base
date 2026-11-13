import { z } from 'zod';

export const updateSampleArticleSchema = z.object({
  title:    z.string().min(1).max(200).optional(),
  slug:     z.string()
              .min(1)
              .max(200)
              .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case (letters, numbers, and single hyphens)')
              .optional(),
  body:     z.string().min(1).optional(),
  status:   z.enum(['DRAFT', 'PUBLISHED']).optional(),
  featured: z.boolean().optional(),
});

export type UpdateSampleArticleDto = z.infer<typeof updateSampleArticleSchema>;
