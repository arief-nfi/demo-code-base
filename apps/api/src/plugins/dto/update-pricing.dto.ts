import { z } from 'zod';

export const updatePricingSchema = z.object({
  pricingModel: z.enum(['FREE', 'MONTHLY', 'YEARLY', 'ONE_TIME']),
  price: z.number().min(0).nullable().optional(),
  pricingCurrency: z.string().min(1).max(3).default('USD'),
  trialDays: z.number().int().min(0).default(0),
  pricingLabel: z.string().max(50).nullable().optional(),
}).refine(
  (data) => data.pricingModel === 'FREE' || (data.price != null && data.price > 0),
  { message: 'Price is required for paid plugins', path: ['price'] },
);

export type UpdatePricingDto = z.infer<typeof updatePricingSchema>;
