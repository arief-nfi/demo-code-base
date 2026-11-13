import { NotFoundException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CatalogService } from './catalog.service';
import { CreditService } from './credit.service';
import { createBillingDb, type BillingDb } from './testing/in-memory-billing-db';
import type { BillingSettingsView, BillingProfileView } from './billing-settings.service';

const T1 = 'tenant-1';
const T2 = 'tenant-2';

function setup() {
  const db: BillingDb = createBillingDb();
  db.plugin.rows.push(
    { key: 'docs', name: 'Document Templates', isEnabled: true, pricingModel: 'MONTHLY', price: '150000.00', pricingCurrency: 'IDR' },
    { key: 'integ', name: 'Integration', isEnabled: false, pricingModel: 'YEARLY', price: '120.00', pricingCurrency: 'USD' },
    { key: 'free', name: 'Free One', isEnabled: true, pricingModel: 'FREE', price: null, pricingCurrency: 'USD' },
    { key: 'inventory', name: 'Inventory', isEnabled: true, pricingModel: 'MONTHLY', price: '150000.00', pricingCurrency: 'IDR' },
    { key: 'procurement', name: 'Procurement', isEnabled: true, pricingModel: 'MONTHLY', price: '100000.00', pricingCurrency: 'IDR' },
  );
  db.app.rows.push({ id: 'app-1', key: 'warehouse', name: 'Warehouse', isPublished: true, pricingModel: 'MONTHLY', price: '200000.00', pricingCurrency: 'IDR', trialDays: 0 });
  db.appPlugin.rows.push({ appId: 'app-1', pluginKey: 'inventory', position: 0 }, { appId: 'app-1', pluginKey: 'procurement', position: 1 });
  db.tenant.rows.push({ id: T1, slug: 'acme', name: 'Acme Corp' }, { id: T2, slug: 'beta', name: 'Beta Ltd' });

  const settings: BillingSettingsView = {
    taxEnabled: true, taxName: 'PPN', taxRate: 11, renewalLeadDays: 7, graceDays: 7, checkoutValidHours: 24,
    sellerName: 'PT Platform', sellerAddress: 'Jakarta', sellerTaxId: '01.000', sellerEmail: 'billing@platform.test',
  };
  const profiles: Record<string, BillingProfileView> = {
    [T1]: { companyName: 'PT Acme Indonesia', billingEmail: 'finance@acme.test', address: 'Jl. Sudirman 1', taxId: '01.234' },
  };
  const settingsService = {
    getSettings: jest.fn(async () => ({ ...settings })),
    getProfile: jest.fn(async (tenantId: string) => profiles[tenantId] ?? { companyName: null, billingEmail: null, address: null, taxId: null }),
  };
  const credits = new CreditService(db as any);
  const service = new InvoiceService(db as any, settingsService as any, new CatalogService(db as any), credits);
  return { db, settings, profiles, service, credits };
}

const issue = (service: InvoiceService, over: Partial<Parameters<InvoiceService['issueInvoice']>[0]> = {}) =>
  service.issueInvoice({
    tenantId: T1,
    tenantSlug: 'acme',
    pluginKey: 'docs',
    kind: 'FIRST',
    anchor: new Date('2026-10-20T00:00:00Z'),
    periodStart: null,
    periodEnd: null,
    dueAt: new Date('2026-10-21T00:00:00Z'),
    now: new Date('2026-10-20T00:00:00Z'),
    ...over,
  });

describe('InvoiceService', () => {
  it('numbers invoices INV-2026-0001, INV-2026-0002 and restarts at 0001 in 2027', async () => {
    const { service } = setup();
    const a = await issue(service, { anchor: new Date('2026-10-20T00:00:00Z') });
    const b = await issue(service, { anchor: new Date('2026-11-20T00:00:00Z'), kind: 'RENEWAL' });
    const c = await issue(service, { anchor: new Date('2027-01-05T00:00:00Z'), kind: 'RENEWAL', now: new Date('2027-01-05T00:00:00Z') });

    expect([a.invoice.number, b.invoice.number, c.invoice.number]).toEqual(['INV-2026-0001', 'INV-2026-0002', 'INV-2027-0001']);
  });

  it('issuing the same dedupeKey twice returns the first invoice with created=false', async () => {
    const { db, service } = setup();
    const first = await issue(service);
    const again = await issue(service);

    expect(first.created).toBe(true);
    expect(again).toEqual({ invoice: expect.objectContaining({ id: first.invoice.id }), created: false });
    expect(db.invoice.rows).toHaveLength(1);
  });

  it('a VOID invoice still blocks re-issue for the same key', async () => {
    const { db, service } = setup();
    const first = await issue(service);
    db.invoice.rows[0].status = 'VOID';

    const again = await issue(service);
    expect(again.created).toBe(false);
    expect(again.invoice.id).toBe(first.invoice.id);
  });

  it('a concurrent duplicate (unique violation on dedupeKey) returns the existing invoice', async () => {
    const { db, service } = setup();
    const first = await issue(service);
    // Simulate the race: the lookup misses, the insert then hits the unique index.
    const realFindUnique = db.invoice.findUnique.bind(db.invoice);
    let calls = 0;
    db.invoice.findUnique = (async (args: any) => (args.where.dedupeKey && calls++ === 0 ? null : realFindUnique(args))) as any;

    const again = await issue(service);
    expect(again).toEqual({ invoice: expect.objectContaining({ id: first.invoice.id }), created: false });
  });

  it('snapshots price, tax, seller and bill-to at issue time', async () => {
    const { db, service, settings, profiles } = setup();
    const { invoice } = await issue(service);

    settings.taxEnabled = false;
    settings.sellerName = 'Renamed';
    profiles[T1].companyName = 'Renamed Co';
    db.plugin.rows[0].price = '999999.00';

    const stored = await service.getForTenant(T1, invoice.id);
    expect(stored).toMatchObject({
      tenantSlug: 'acme', pluginName: 'Document Templates', pricingModel: 'MONTHLY', currency: 'IDR',
      subtotal: '150000', taxName: 'PPN', taxRate: '11.00', taxAmount: '16500', total: '166500',
      dueAt: new Date('2026-10-21T00:00:00Z'),
    });
    expect(stored.sellerSnapshot).toEqual({ name: 'PT Platform', address: 'Jakarta', taxId: '01.000', email: 'billing@platform.test' });
    expect(stored.billToSnapshot).toEqual({ name: 'PT Acme Indonesia', email: 'finance@acme.test', address: 'Jl. Sudirman 1', taxId: '01.234' });
  });

  it('bills to the tenant name when there is no billing profile', async () => {
    const { service } = setup();
    const { invoice } = await issue(service, { tenantId: T2, tenantSlug: 'beta' });
    expect(invoice.billToSnapshot).toMatchObject({ name: 'Beta Ltd', email: null });
  });

  it('refuses to invoice a free plugin', async () => {
    const { service } = setup();
    await expect(issue(service, { pluginKey: 'free' })).rejects.toThrow();
  });

  it("getForTenant 404s for another tenant's invoice", async () => {
    const { service } = setup();
    const { invoice } = await issue(service);
    await expect(service.getForTenant(T2, invoice.id)).rejects.toThrow(NotFoundException);
  });

  it('findOpenForSubscription returns the open invoice for that plugin only', async () => {
    const { db, service } = setup();
    const { invoice } = await issue(service);
    expect((await service.findOpenForSubscription(T1, 'docs'))?.id).toBe(invoice.id);
    expect(await service.findOpenForSubscription(T1, 'integ')).toBeNull();
    db.invoice.rows[0].status = 'PAID';
    expect(await service.findOpenForSubscription(T1, 'docs')).toBeNull();
  });

  it('adminSummary excludes complimentary payments and sums per currency', async () => {
    const { db, service } = setup();
    const now = new Date('2026-10-25T00:00:00Z');
    const base = { tenantSlug: 'acme', pluginKey: 'docs', pluginName: 'D', kind: 'FIRST', pricingModel: 'MONTHLY', subtotal: '0', sellerSnapshot: {}, billToSnapshot: {} };
    db.invoice.rows.push(
      { ...base, id: 'i1', number: 'n1', dedupeKey: 'k1', tenantId: T1, currency: 'IDR', total: '166500', status: 'PAID', paidAt: new Date('2026-10-10T00:00:00Z'), complimentary: false, dueAt: now, activationError: null },
      { ...base, id: 'i2', number: 'n2', dedupeKey: 'k2', tenantId: T1, currency: 'IDR', total: '100000', status: 'PAID', paidAt: new Date('2026-10-11T00:00:00Z'), complimentary: true, dueAt: now, activationError: null },
      { ...base, id: 'i3', number: 'n3', dedupeKey: 'k3', tenantId: T2, currency: 'USD', total: '13.32', status: 'PAID', paidAt: new Date('2026-10-12T00:00:00Z'), complimentary: false, dueAt: now, activationError: 'boom' },
      { ...base, id: 'i4', number: 'n4', dedupeKey: 'k4', tenantId: T1, currency: 'IDR', total: '50000', status: 'PAID', paidAt: new Date('2026-09-30T23:59:59Z'), complimentary: false, dueAt: now, activationError: null },
      { ...base, id: 'i5', number: 'n5', dedupeKey: 'k5', tenantId: T2, currency: 'USD', total: '20.00', status: 'OPEN', paidAt: null, complimentary: false, dueAt: new Date('2026-10-20T00:00:00Z'), activationError: null },
      { ...base, id: 'i6', number: 'n6', dedupeKey: 'k6', tenantId: T1, currency: 'USD', total: '5.00', status: 'OPEN', paidAt: null, complimentary: false, dueAt: new Date('2026-11-01T00:00:00Z'), activationError: null },
    );

    const summary = await service.adminSummary(now);
    expect(summary.paidThisMonth).toEqual(expect.arrayContaining([{ currency: 'IDR', amount: '166500' }, { currency: 'USD', amount: '13.32' }]));
    expect(summary.paidThisMonth).toHaveLength(2);
    expect(summary.outstanding).toEqual([{ currency: 'USD', amount: '25.00' }]);
    expect(summary.overdueTenants).toBe(1);
    expect(summary.activationFailures).toBe(1);
    expect(summary.disabledPaidPlugins).toEqual(['integ']);
  });

  it('listAdmin OVERDUE returns only OPEN invoices past dueAt', async () => {
    const { service } = setup();
    await issue(service, { anchor: new Date('2026-10-01T00:00:00Z'), dueAt: new Date('2026-10-02T00:00:00Z') });
    await issue(service, { anchor: new Date('2026-10-20T00:00:00Z'), dueAt: new Date('2026-11-01T00:00:00Z') });

    const result = await service.listAdmin({ status: 'OVERDUE', page: 1, limit: 20 }, new Date('2026-10-25T00:00:00Z'));
    expect(result.data.map((i) => i.dueAt.toISOString())).toEqual(['2026-10-02T00:00:00.000Z']);
    expect(result.meta).toEqual({ total: 1, page: 1, limit: 20 });
  });

  it('listAdmin filters by tenant slug and plugin key', async () => {
    const { service } = setup();
    await issue(service);
    await issue(service, { tenantId: T2, tenantSlug: 'beta', pluginKey: 'integ' });

    expect((await service.listAdmin({ tenant: 'beta', page: 1, limit: 20 })).data.map((i) => i.pluginKey)).toEqual(['integ']);
    expect((await service.listAdmin({ plugin: 'docs', page: 1, limit: 20 })).data.map((i) => i.tenantSlug)).toEqual(['acme']);
  });

  describe('products and credit', () => {
    it('an app invoice snapshots the app name and what it includes', async () => {
      const { service } = setup();
      const { invoice } = await issue(service, { pluginKey: 'app:warehouse' });
      expect(invoice).toMatchObject({
        pluginKey: 'app:warehouse',
        pluginName: 'Warehouse',
        subtotal: '200000',
        includes: [{ key: 'inventory', name: 'Inventory' }, { key: 'procurement', name: 'Procurement' }],
      });
    });

    it('a plugin invoice includes nothing', async () => {
      const { service } = setup();
      const { invoice } = await issue(service);
      expect(invoice.includes).toBeNull();
      expect(invoice.creditAmount).toBe('0');
    });

    it('available credit comes off the invoice and is recorded as used', async () => {
      const { service, credits, db } = setup();
      await credits.grant({ tenantId: T1, currency: 'IDR', amount: '50000', reason: 'Unused time', sourceKey: 'inventory' });
      const { invoice } = await issue(service);
      // 150000 − 50000 = 100000, PPN 11% on 100000 = 11000
      expect(invoice).toMatchObject({ subtotal: '150000', creditAmount: '50000', taxAmount: '11000', total: '111000' });
      await expect(credits.balance(T1, 'IDR')).resolves.toBe('0');
      expect(db.billingCredit.rows.find((r) => r.kind === 'USE')).toMatchObject({ invoiceId: invoice.id, amount: '-50000' });
    });

    it('a credit bigger than one invoice covers it and carries the rest to the next', async () => {
      const { service, credits } = setup();
      await credits.grant({ tenantId: T1, currency: 'IDR', amount: '200000', reason: 'Unused time', sourceKey: 'inventory' });

      const first = await issue(service, { anchor: new Date('2026-10-20T00:00:00Z') });
      const second = await issue(service, { anchor: new Date('2026-11-20T00:00:00Z'), kind: 'RENEWAL' });

      // Taken up to the subtotal: no tax on a covered invoice; the 50000 left comes off the next one
      expect(first.invoice).toMatchObject({ subtotal: '150000', creditAmount: '150000', taxAmount: '0', total: '0' });
      expect(second.invoice).toMatchObject({ subtotal: '150000', creditAmount: '50000', taxAmount: '11000', total: '111000' });
      await expect(credits.balance(T1, 'IDR')).resolves.toBe('0');
    });

    it('credit in another currency is not used', async () => {
      const { service, credits } = setup();
      await credits.grant({ tenantId: T1, currency: 'USD', amount: '5.00', reason: 'Unused time', sourceKey: 'integ' });
      const { invoice } = await issue(service);
      expect(invoice.creditAmount).toBe('0');
      await expect(credits.balance(T1, 'USD')).resolves.toBe('5.00');
    });

    it('unknown and free products are refused', async () => {
      const { service } = setup();
      await expect(issue(service, { pluginKey: 'app:nope' })).rejects.toThrow('"app:nope" not found.');
      await expect(issue(service, { pluginKey: 'free' })).rejects.toThrow('"free" has no price to invoice.');
    });
  });
});
