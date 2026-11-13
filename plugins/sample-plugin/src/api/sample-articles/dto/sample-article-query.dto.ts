import { z } from 'zod';

export const sampleArticleQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).optional(),
  limit:     z.coerce.number().int().min(1).max(100).optional(),
  search:    z.string().optional(),
  sortBy:    z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  status:    z.enum(['DRAFT', 'PUBLISHED']).optional(),
});

export type SampleArticleQueryDto = z.infer<typeof sampleArticleQuerySchema>;
