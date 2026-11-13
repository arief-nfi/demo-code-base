import { z } from 'zod';

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  htmlContent: z.string().min(1, 'HTML content is required'),
  cssContent: z.string().optional(),
  headerHtml: z.string().optional(),
  footerHtml: z.string().optional(),
  paperSize: z.enum(['A4', 'Letter', 'Legal']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  marginTop: z.string().default('20mm'),
  marginBottom: z.string().default('20mm'),
  marginLeft: z.string().default('15mm'),
  marginRight: z.string().default('15mm'),
  sampleData: z.string().optional(),
});

export type CreateTemplateDto = z.infer<typeof createTemplateSchema>;
