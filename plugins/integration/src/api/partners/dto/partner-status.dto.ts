import { z } from 'zod';

export const partnerStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
});

export type PartnerStatusDto = z.infer<typeof partnerStatusSchema>;
