import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import type { BillingProfileDto, BillingSettingsDto } from './billing.schemas';

export interface BillingSettingsView {
  taxEnabled: boolean;
  taxName: string;
  taxRate: number;
  renewalLeadDays: number;
  graceDays: number;
  checkoutValidHours: number;
  sellerName: string | null;
  sellerAddress: string | null;
  sellerTaxId: string | null;
  sellerEmail: string | null;
}

export interface BillingProfileView {
  companyName: string | null;
  billingEmail: string | null;
  address: string | null;
  taxId: string | null;
}

const SETTINGS_ID = 'default';

/** Empty strings from forms are stored as null. */
function blankToNull<T extends Record<string, unknown>>(dto: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dto)) {
    if (value !== undefined) out[key] = value === '' ? null : value;
  }
  return out as T;
}

/** Platform billing settings (one row, public schema) and each tenant's billing profile. */
@Injectable()
export class BillingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(): Promise<BillingSettingsView> {
    const row = await this.prisma.billingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
    });
    return this.toSettingsView(row);
  }

  async updateSettings(dto: BillingSettingsDto): Promise<BillingSettingsView> {
    const data = blankToNull(dto);
    const row = await this.prisma.billingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return this.toSettingsView(row);
  }

  async getProfile(tenantId: string): Promise<BillingProfileView> {
    const row = await this.prisma.billingProfile.findUnique({ where: { tenantId } });
    return this.toProfileView(row);
  }

  async updateProfile(tenantId: string, dto: BillingProfileDto): Promise<BillingProfileView> {
    const data = blankToNull(dto);
    const row = await this.prisma.billingProfile.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return this.toProfileView(row);
  }

  private toSettingsView(row: {
    taxEnabled: boolean; taxName: string; taxRate: { toString(): string }; renewalLeadDays: number; graceDays: number;
    checkoutValidHours: number; sellerName: string | null; sellerAddress: string | null; sellerTaxId: string | null; sellerEmail: string | null;
  }): BillingSettingsView {
    return {
      taxEnabled: row.taxEnabled,
      taxName: row.taxName,
      taxRate: Number(row.taxRate.toString()),
      renewalLeadDays: row.renewalLeadDays,
      graceDays: row.graceDays,
      checkoutValidHours: row.checkoutValidHours,
      sellerName: row.sellerName,
      sellerAddress: row.sellerAddress,
      sellerTaxId: row.sellerTaxId,
      sellerEmail: row.sellerEmail,
    };
  }

  private toProfileView(row: Partial<BillingProfileView> | null): BillingProfileView {
    return {
      companyName: row?.companyName ?? null,
      billingEmail: row?.billingEmail ?? null,
      address: row?.address ?? null,
      taxId: row?.taxId ?? null,
    };
  }
}
