import { z } from 'zod';

export const sampleSettingSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1),
  description: z.string().optional(),
});

export type SampleSettingDto = z.infer<typeof sampleSettingSchema>;
