import { z } from 'zod';

export const saveEmailTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  html: z.string().max(100_000),
});

export type SaveEmailTemplateDto = z.infer<typeof saveEmailTemplateSchema>;

/**
 * Preview and test send take an optional draft; without one (no body, or `{}`)
 * they use the current template.
 */
export const draftEmailTemplateSchema = z.object({
  subject: z.string().max(200).optional(),
  html: z.string().max(100_000).optional(),
}).optional();

export type DraftEmailTemplateDto = z.infer<typeof draftEmailTemplateSchema>;
