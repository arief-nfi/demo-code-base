import { NotFoundException } from '@nestjs/common';
import { TenantAppsService } from './tenant-apps.service';
import { AppsCatalogService } from './apps-catalog.service';
import { CatalogService } from '../billing/catalog.service';
import { CreditService } from '../billing/credit.service';
import { InvoiceService } from '../billing/invoice.service';
import { createBillingDb, type BillingDb } from '../billing/testing/in-memory-billing-db';

jest.mock('../plugin-registry', () => ({ PluginManifests: {} }));

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function setup(subs: Array<Record<string, unknown>> = []) {
  const db: BillingDb = createBillingDb();
  db.plugin.rows.push(
    { key: 'inventory', name: 'Inventory', isEnabled: true, pricingModel: 'MONTHLY', price: '150000.00', pricingCurrency: 'IDR', trialDays: 0 },
    { key: 'procurement', name: 'Procurement', isEnabled: true, pricingModel: 'MONTHLY', price: '100000.00', pricingCurrency: 'IDR', trialDays: 0 },
    { key: 'reports', name: 'Reports', isEnabled: true, pricingModel: 'MONTHLY', price: '50000.00', pricingCurrency: 'IDR', trialDays: 0 },
    { key: 'extra', name: 'Extra', isEnabled: true, pricingModel: 'MONTHLY', price: '10000.00', pricingCurrency: 'IDR', trialDays: 0 },
  );
  db.app.rows.push(
    { id: 'app-1', key: 'warehouse', name: 'Warehouse', description: 'Stock', icon: 'warehouse', isPublished: true, pricingModel: 'MONTHLY', price: '200000.00', pricingCurrency: 'IDR', trialDays: 14, pricingLabel: null },
    { id: 'app-2', key: 'retail', name: 'Retail', description: null, icon: 'store', isPublished: true, pricingModel: 'MONTHLY', price: '120000.00', pricingCurrency: 'IDR', trialDays: 0, pricingLabel: null },
    { id: 'app-3', key: 'legacy', name: 'Legacy', description: null, icon: 'package', isPublished: false, pricingModel: 'MONTHLY', price: '50000.00', pricingCurrency: 'IDR', trialDays: 0, pricingLabel: null },
  );
  db.appPlugin.rows.push(
    { appId: 'app-1', pluginKey: 'inventory', position: 0 },
    { appId: 'app-1', pluginKey: 'procurement', position: 1 },
    { appId: 'app-1', pluginKey: 'reports', position: 2 },
    { appId: 'app-1', pluginKey: 'extra', position: 3 },
    { appId: 'app-2', pluginKey: 'inventory', position: 0 },
    { appId: 'app-3', pluginKey: 'reports', position: 0 },
  );
  db.tenant.rows.push({ id: 't1', slug: 'acme', name: 'Acme', status: 'ACTIVE' });
  const prisma: any = {
    get plugin() { return db.plugin; },
    get tenant() { return db.tenant; },
    get app() { return db.app; },
    get appPlugin() { return db.appPlugin; },
    get invoice() { return db.invoice; },
    get billingCredit() { return db.billingCredit; },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    getTenantClient: jest.fn(() => ({
      tenantSubscription: {
        findMany: jest.fn(async () => subs.map((s) => ({ ...s }))),
        findUnique: jest.fn(async ({ where }: any) => subs.find((s) => s.pluginKey === where.pluginKey) ?? null),
      },
    })),
  };
  const catalog = new CatalogService(prisma);
  const credits = new CreditService(prisma);
  const invoices = new InvoiceService(prisma, {} as any, catalog, credits);
  const appsCatalog = new AppsCatalogService(prisma, { emit: jest.fn() } as any);
  return { db, credits, service: new TenantAppsService(prisma, catalog, credits, invoices, appsCatalog) };
}

const sub = (pluginKey: string, over: Record<string, unknown> = {}) => ({
  pluginKey, status: 'ACTIVE', pricingModel: 'MONTHLY', currency: 'IDR', trialEndsAt: null, cancelAtPeriodEnd: false,
  currentPeriodStart: d('2026-11-01'), currentPeriodEnd: d('2026-12-01'), grantedPlugins: [], ...over,
});

describe('TenantAppsService', () => {
  it('store lists published apps with owned flags and saving', async () => {
    const { service } = setup([sub('inventory')]);
    const store = await service.store('acme', 't1');

    expect(store.map((a) => a.key)).toEqual(['retail', 'warehouse']);
    const warehouse = store.find((a) => a.key === 'warehouse')!;
    expect(warehouse).toMatchObject({
      name: 'Warehouse', description: 'Stock', icon: 'warehouse', savingPercent: 35, subscription: null, canStartTrial: true,
      pricing: { pricingModel: 'MONTHLY', price: '200000.00', currency: 'IDR', trialDays: 14, pricingLabel: null },
    });
    expect(warehouse.plugins).toEqual([
      { key: 'inventory', name: 'Inventory', owned: true },
      { key: 'procurement', name: 'Procurement', owned: false },
      { key: 'reports', name: 'Reports', owned: false },
      { key: 'extra', name: 'Extra', owned: false },
    ]);
  });

  it('store shows a hidden app the tenant still holds, with its subscription', async () => {
    const { service } = setup([sub('app:legacy', { grantedPlugins: ['reports'] })]);
    const legacy = (await service.store('acme', 't1')).find((a) => a.key === 'legacy');
    expect(legacy).toMatchObject({ subscription: { status: 'ACTIVE', displayStatus: 'ACTIVE', currentPeriodEnd: d('2026-12-01'), openInvoiceId: null } });
  });

  it('a used trial can\'t be started again', async () => {
    const { service } = setup([sub('app:warehouse', { status: 'ENDED', trialEndsAt: d('2026-10-01') })]);
    expect((await service.store('acme', 't1')).find((a) => a.key === 'warehouse')?.canStartTrial).toBe(false);
  });

  it('preview says what happens to each plugin the tenant already has', async () => {
    const { db, service } = setup([
      sub('inventory'),
      sub('procurement', { currency: 'USD' }),
      sub('reports', { pricingModel: 'ONE_TIME', currentPeriodEnd: null }),
    ]);
    db.invoice.rows.push({
      id: 'paid', number: 'INV-2026-0001', dedupeKey: 'paid', tenantId: 't1', pluginKey: 'inventory', status: 'PAID', complimentary: false,
      periodStart: d('2026-11-01'), periodEnd: d('2026-12-01'), subtotal: '150000', currency: 'IDR',
    });

    const preview = await service.preview('acme', 't1', 'warehouse', d('2026-11-16'));

    expect(preview.plugins).toEqual([
      { key: 'inventory', name: 'Inventory', action: 'end-with-credit', creditEstimate: '75000', currentPeriodEnd: d('2026-12-01') },
      { key: 'procurement', name: 'Procurement', action: 'stop-renewing', creditEstimate: null, currentPeriodEnd: d('2026-12-01') },
      { key: 'reports', name: 'Reports', action: 'keep-owned', creditEstimate: null, currentPeriodEnd: null },
      { key: 'extra', name: 'Extra', action: 'none', creditEstimate: null, currentPeriodEnd: null },
    ]);
    expect(preview.app.key).toBe('warehouse');
    expect(preview.creditBalance).toBe('0');
  });

  it('preview lists overlaps with another live app and the credit balance', async () => {
    const { service, credits } = setup([sub('app:retail', { grantedPlugins: ['inventory'] })]);
    await credits.grant({ tenantId: 't1', currency: 'IDR', amount: '30000', reason: 'Unused time', sourceKey: 'x' });

    const preview = await service.preview('acme', 't1', 'warehouse');

    expect(preview.overlaps).toEqual([{ pluginKey: 'inventory', pluginName: 'Inventory', appName: 'Retail' }]);
    expect(preview.creditBalance).toBe('30000');
  });

  it('preview of an unknown app, or a hidden one the tenant doesn\'t hold, is NotFound', async () => {
    const { service } = setup();
    await expect(service.preview('acme', 't1', 'nope')).rejects.toThrow(NotFoundException);
    await expect(service.preview('acme', 't1', 'legacy')).rejects.toThrow(NotFoundException);
  });

  it('menu returns live apps only, plugins in app order', async () => {
    const { service } = setup([
      sub('app:warehouse', { grantedPlugins: ['procurement', 'inventory'] }),
      sub('app:retail', { status: 'PAUSED', grantedPlugins: ['inventory'] }),
    ]);
    await expect(service.menu('acme')).resolves.toEqual([{ key: 'warehouse', name: 'Warehouse', icon: 'warehouse', plugins: ['inventory', 'procurement'] }]);
  });
});
