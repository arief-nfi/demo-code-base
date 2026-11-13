import { z } from 'zod';
import { APP_ICONS } from './app-icons';

const pricingModel = z.enum(['FREE', 'MONTHLY', 'YEARLY', 'ONE_TIME']);
const currency = z.enum(['USD', 'IDR']);
const pluginKeys = z
  .array(z.string().min(1).max(100))
  .max(30)
  .refine((keys) => new Set(keys).size === keys.length, 'Each plugin can be added once');

const appFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  icon: z.enum(APP_ICONS),
  plugins: pluginKeys.min(1, 'Pick at least one plugin'),
  pricingModel,
  price: z.number().min(0).nullable().optional(),
  pricingCurrency: currency,
  trialDays: z.number().int().min(0).max(365),
  pricingLabel: z.string().max(50).nullable().optional(),
  isPublished: z.boolean(),
};

/** Sysadmin: create an app. The key is fixed after create. */
export const appCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'Use 2–49 lowercase letters, digits or dashes, starting with a letter or digit'),
  ...appFields,
});

/** Sysadmin: change an app (fields left out keep their value). */
export const appUpdateSchema = z.object(appFields).partial();

/** Sysadmin form preview: missing dependencies and the saving against buying the plugins one by one. */
export const appQuoteSchema = z.object({
  plugins: pluginKeys,
  pricingModel,
  price: z.number().min(0).nullable().optional(),
  pricingCurrency: currency,
});

export type AppCreateDto = z.infer<typeof appCreateSchema>;
export type AppUpdateDto = z.infer<typeof appUpdateSchema>;
export type AppQuoteDto = z.infer<typeof appQuoteSchema>;
