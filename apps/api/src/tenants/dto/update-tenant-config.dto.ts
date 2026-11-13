import { z } from 'zod';

export enum Theme {
  LIGHT = 'LIGHT',
  DARK = 'DARK',
}

export enum Language {
  ENGLISH = 'ENGLISH',
  INDONESIA = 'INDONESIA',
}

export enum Currency {
  USD = 'USD',
  IDR = 'IDR',
}

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color (e.g., #2563EB)').optional().nullable();

export const updateTenantConfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  logo: z.string().optional(),
  icon: z.string().optional(),
  domain: z.string().optional(),
  theme: z.nativeEnum(Theme).optional(),
  language: z.nativeEnum(Language).optional(),
  currency: z.nativeEnum(Currency).optional(),
  timezone: z.string().optional(),
  dateFormat: z.string().optional(),
  timeFormat: z.string().optional(),
  numberFormat: z.string().optional(),
  currencyFormat: z.string().optional(),
  primaryColor: hexColor,
  accentColor: hexColor,
  sidebarBackground: hexColor,
  sidebarForeground: hexColor,
});

export type UpdateTenantConfigDto = z.infer<typeof updateTenantConfigSchema>;
