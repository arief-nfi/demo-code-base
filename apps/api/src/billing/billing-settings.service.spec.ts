import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from '@saas/backend';
import { BillingSettingsService } from './billing-settings.service';
import { billingProfileSchema, billingSettingsSchema } from './billing.schemas';

const DEFAULT_ROW = {
  id: 'default',
  taxEnabled: false,
  taxName: 'PPN',
  taxRate: { toString: () => '11' },
  renewalLeadDays: 7,
  graceDays: 7,
  checkoutValidHours: 24,
  sellerName: null,
  sellerAddress: null,
  sellerTaxId: null,
  sellerEmail: null,
  updatedAt: new Date(),
};

function setup() {
  const prisma = {
    billingSettings: {
      upsert: jest.fn(async () => DEFAULT_ROW),
    },
    billingProfile: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ create }: any) => ({ ...create, updatedAt: new Date() })),
    },
  };
  return { prisma, service: new BillingSettingsService(prisma as any) };
}

const meta = { type: 'body' as const };

describe('BillingSettingsService', () => {
  it('getSettings creates the default row with tax off, PPN, 11, 7, 7, 24', async () => {
    const { prisma, service } = setup();
    const settings = await service.getSettings();

    expect(prisma.billingSettings.upsert).toHaveBeenCalledWith({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
    expect(settings).toMatchObject({
      taxEnabled: false, taxName: 'PPN', taxRate: 11, renewalLeadDays: 7, graceDays: 7, checkoutValidHours: 24,
    });
  });

  it('updateSettings writes the given fields and stores empty seller fields as null', async () => {
    const { prisma, service } = setup();
    await service.updateSettings({ taxEnabled: true, sellerName: '' });

    expect(prisma.billingSettings.upsert).toHaveBeenLastCalledWith({
      where: { id: 'default' },
      create: { id: 'default', taxEnabled: true, sellerName: null },
      update: { taxEnabled: true, sellerName: null },
    });
  });

  it('getProfile returns empty fields for a tenant without a profile', async () => {
    const { service } = setup();
    await expect(service.getProfile('t1')).resolves.toEqual({ companyName: null, billingEmail: null, address: null, taxId: null });
  });

  it('updateProfile upserts by tenantId', async () => {
    const { prisma, service } = setup();
    const profile = await service.updateProfile('t1', { companyName: 'PT Acme', billingEmail: 'finance@acme.test' });

    expect(prisma.billingProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1' } }));
    expect(profile).toMatchObject({ companyName: 'PT Acme', billingEmail: 'finance@acme.test' });
  });
});

describe('billing schemas (through ZodValidationPipe, as the controllers use them)', () => {
  const settingsPipe = new ZodValidationPipe(billingSettingsSchema);
  const profilePipe = new ZodValidationPipe(billingProfileSchema);

  it('rejects taxRate 101', () => {
    expect(() => settingsPipe.transform({ taxRate: 101 }, meta)).toThrow(BadRequestException);
  });

  it.each([
    { renewalLeadDays: 61 },
    { graceDays: -1 },
    { checkoutValidHours: 0 },
    { taxName: '' },
    { sellerEmail: 'not-an-email' },
  ])('rejects %o', (body) => {
    expect(() => settingsPipe.transform(body, meta)).toThrow(BadRequestException);
  });

  it('accepts a full valid settings form, empty seller email included', () => {
    const body = {
      taxEnabled: true, taxName: 'PPN', taxRate: 11, renewalLeadDays: 7, graceDays: 7, checkoutValidHours: 24,
      sellerName: 'PT Platform', sellerAddress: 'Jakarta', sellerTaxId: '01.234', sellerEmail: '',
    };
    expect(settingsPipe.transform(body, meta)).toEqual(body);
  });

  it('profile: billingEmail must be an email or empty', () => {
    expect(() => profilePipe.transform({ billingEmail: 'nope' }, meta)).toThrow(BadRequestException);
    expect(profilePipe.transform({ billingEmail: '' }, meta)).toEqual({ billingEmail: '' });
  });
});
