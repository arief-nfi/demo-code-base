import { z } from 'zod';

const optionalText = z.string().max(500).nullable().optional();
const optionalEmail = z.union([z.literal(''), z.string().email('Invalid email address')]).nullable().optional();

/** Sysadmin billing settings (partial update — omitted fields keep their value). */
export const billingSettingsSchema = z
  .object({
    taxEnabled: z.boolean(),
    taxName: z.string().min(1).max(20),
    taxRate: z.number().min(0).max(100),
    renewalLeadDays: z.number().int().min(0).max(60),
    graceDays: z.number().int().min(0).max(60),
    checkoutValidHours: z.number().int().min(1).max(720),
    sellerName: optionalText,
    sellerAddress: optionalText,
    sellerTaxId: optionalText,
    sellerEmail: optionalEmail,
  })
  .partial();

export type BillingSettingsDto = z.infer<typeof billingSettingsSchema>;

/** A tenant's billing details, printed on its invoices. */
export const billingProfileSchema = z
  .object({
    companyName: optionalText,
    billingEmail: optionalEmail,
    address: optionalText,
    taxId: optionalText,
  })
  .partial();

export type BillingProfileDto = z.infer<typeof billingProfileSchema>;

/** Sysadmin invoice list filters (query string). */
export const adminInvoiceQuerySchema = z.object({
  status: z.enum(['OPEN', 'PAID', 'VOID', 'OVERDUE']).optional(),
  tenant: z.string().min(1).max(100).optional(),
  plugin: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminInvoiceQueryDto = z.infer<typeof adminInvoiceQuerySchema>;

/** Fake payment page: which outcome to simulate. */
export const simulateSchema = z.object({ outcome: z.enum(['PAID', 'FAILED', 'EXPIRED']) });

export type SimulateDto = z.infer<typeof simulateSchema>;

/** Sysadmin Mark paid: a transfer made outside the system, or a complimentary period. */
export const markPaidSchema = z.object({
  method: z.enum(['bank_transfer', 'complimentary']),
  reference: z.string().max(200).optional(),
});

export type MarkPaidDto = z.infer<typeof markPaidSchema>;
