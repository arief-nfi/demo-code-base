import { z } from 'zod';

export const createSampleArticleSchema = z.object({
  title:    z.string().min(1, 'Title is required').max(200),
  slug:     z.string()
              .min(1, 'Slug is required')
              .max(200)
              .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case (letters, numbers, and single hyphens)'),
  body:     z.string().min(1, 'Body is required'),
  status:   z.enum(['DRAFT', 'PUBLISHED']).optional(),
  featured: z.boolean().optional(),
});

export type CreateSampleArticleDto = z.infer<typeof createSampleArticleSchema>;
