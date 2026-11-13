import { z } from 'zod';
import { createTemplateSchema } from './create-template.dto';

export const updateTemplateSchema = createTemplateSchema.partial();

export type UpdateTemplateDto = z.infer<typeof updateTemplateSchema>;
