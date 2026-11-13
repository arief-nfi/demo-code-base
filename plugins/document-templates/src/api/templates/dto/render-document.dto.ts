import { z } from 'zod';

export const renderDocumentSchema = z.object({
  templateSlug: z.string().min(1, 'Template slug is required'),
  data: z.record(z.string(), z.unknown()).default({}),
  format: z.enum(['pdf', 'html']).default('pdf'),
});

export type RenderDocumentDto = z.infer<typeof renderDocumentSchema>;
