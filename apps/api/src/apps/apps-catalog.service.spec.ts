import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SystemEvents } from '@saas/backend';
import { AppsCatalogService } from './apps-catalog.service';
import type { AppCreateDto } from './apps.schemas';
import { createBillingDb, type BillingDb } from '../billing/testing/in-memory-billing-db';

const mockPluginManifests: Record<string, any> = {};
jest.mock('../plugin-registry', () => ({
  get PluginManifests() { return mockPluginManifests; },
}));

function setup() {
  const db: BillingDb = createBillingDb();
  db.plugin.rows.push(
    { key: 'inventory', name: 'Inventory', isEnabled: true, pricingModel: 'MONTHLY', price: '150000.00', pricingCurrency: 'IDR' },
    { key: 'procurement', name: 'Procurement', isEnabled: true, pricingModel: 'MONTHLY', price: '100000.00', pricingCurrency: 'IDR' },
    { key: 'reports', name: 'Reports', isEnabled: true, pricingModel: 'MONTHLY', price: '50000.00', pricingCurrency: 'IDR' },
    { key: 'docs', name: 'Document Templates', isEnabled: true, pricingModel: 'FREE', price: null, pricingCurrency: 'USD' },
  );
  const tenantSubs: Record<string, Record<string, any>> = {};
  const tenantPlugins: Record<string, Record<string, { key: string; isEnabled: boolean }>> = {};
  const clients: Record<string, any> = {};
  const addTenant = (slug: string, sub?: Record<string, unknown>) => {
    db.tenant.rows.push({ id: `id-${slug}`, slug, name: slug, status: 'ACTIVE' });
    tenantSubs[slug] = sub ? { [String(sub.pluginKey)]: sub } : {};
    tenantPlugins[slug] = {};
    clients[slug] = {
      tenantSubscription: {
        findUnique: jest.fn(async ({ where }: any) => tenantSubs[slug][where.pluginKey] ?? null),
        findMany: jest.fn(async ({ where }: any = {}) => Object.values(tenantSubs[slug]).filter((s) => !where?.pluginKey?.in || where.pluginKey.in.includes(s.pluginKey))),
      },
      plugin: {
        findMany: jest.fn(async ({ where }: any = {}) =>
          Object.values(tenantPlugins[slug]).filter((p) => where?.isEnabled === undefined || p.isEnabled === where.isEnabled)),
      },
    };
  };
  const prisma: any = {
    get plugin() { return db.plugin; },
    get tenant() { return db.tenant; },
    get app() { return db.app; },
    get appPlugin() { return db.appPlugin; },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    getTenantClient: jest.fn((slug: string) => clients[slug]),
  };
  const events = { emit: jest.fn() };
  return { db, events, addTenant, clients, tenantPlugins, service: new AppsCatalogService(prisma, events as any) };
}

const warehouse = (over: Partial<AppCreateDto> = {}): AppCreateDto => ({
  key: 'warehouse', name: 'Warehouse', description: 'Stock and buying', icon: 'warehouse',
  plugins: ['inventory', 'procurement'], pricingModel: 'MONTHLY', price: 200000, pricingCurrency: 'IDR',
  trialDays: 14, pricingLabel: null, isPublished: true, ...over,
});

describe('AppsCatalogService', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockPluginManifests)) delete mockPluginManifests[key];
    mockPluginManifests.procurement = { pluginDependencies: { inventory: '^1' } };
  });

  it('creates an app with its plugins in order', async () => {
    const { service } = setup();
    const app = await service.create(warehouse());
    expect(app).toMatchObject({ key: 'warehouse', name: 'Warehouse', plugins: ['inventory', 'procurement'], liveSubscribers: 0, isPublished: true });
    await expect(service.list()).resolves.toEqual([expect.objectContaining({ key: 'warehouse' })]);
  });

  it('refuses a key that is a plugin key, or taken', async () => {
    const { service } = setup();
    await expect(service.create(warehouse({ key: 'inventory' }))).rejects.toThrow('"inventory" is already a plugin key.');
    await service.create(warehouse());
    await expect(service.create(warehouse())).rejects.toThrow('An app with key "warehouse" already exists.');
  });

  it('refuses an unknown plugin', async () => {
    await expect(setup().service.create(warehouse({ plugins: ['inventory', 'nope'] }))).rejects.toThrow('Unknown plugin "nope".');
  });

  it('refuses missing dependencies, naming them', async () => {
    await expect(setup().service.create(warehouse({ plugins: ['procurement'] }))).rejects.toThrow('Add the plugins these need: inventory.');
  });

  it('a paid app needs a price; a free app drops price and trial', async () => {
    const { service } = setup();
    await expect(service.create(warehouse({ price: null }))).rejects.toThrow('Set a price for a paid app.');
    const free = await service.create(warehouse({ pricingModel: 'FREE', price: 5, trialDays: 7 }));
    expect(free).toMatchObject({ price: null, trialDays: 0 });
  });

  it('get of an unknown app is NotFound', async () => {
    await expect(setup().service.get('nope')).rejects.toThrow(NotFoundException);
  });

  it('quote shows a saving when the parts share currency and interval', async () => {
    await expect(setup().service.quote({ plugins: ['inventory', 'procurement', 'docs'], pricingModel: 'MONTHLY', price: 200000, pricingCurrency: 'IDR' }))
      .resolves.toEqual({ missingDependencies: [], sumOfParts: '250000', savingPercent: 20 });
  });

  it('quote has no saving when a part is yearly or in another currency, or the app costs more', async () => {
    const { db, service } = setup();
    await expect(service.quote({ plugins: ['inventory', 'procurement'], pricingModel: 'MONTHLY', price: 300000, pricingCurrency: 'IDR' }))
      .resolves.toEqual({ missingDependencies: [], sumOfParts: '250000', savingPercent: null });
    db.plugin.rows[1].pricingModel = 'YEARLY';
    await expect(service.quote({ plugins: ['inventory', 'procurement'], pricingModel: 'MONTHLY', price: 200000, pricingCurrency: 'IDR' }))
      .resolves.toEqual({ missingDependencies: [], sumOfParts: null, savingPercent: null });
    await expect(service.quote({ plugins: ['inventory'], pricingModel: 'MONTHLY', price: 10, pricingCurrency: 'USD' }))
      .resolves.toMatchObject({ sumOfParts: null, savingPercent: null });
  });

  it('quote lists missing dependencies', async () => {
    await expect(setup().service.quote({ plugins: ['procurement'], pricingModel: 'FREE', price: null, pricingCurrency: 'IDR' }))
      .resolves.toEqual({ missingDependencies: ['inventory'], sumOfParts: null, savingPercent: null });
  });

  it('update emits added and removed plugin keys, and pricing changes', async () => {
    const { service, events } = setup();
    await service.create(warehouse());
    events.emit.mockClear();

    const updated = await service.update('warehouse', { plugins: ['inventory', 'reports'], price: 180000 });

    expect(updated.plugins).toEqual(['inventory', 'reports']);
    expect(events.emit).toHaveBeenCalledWith(SystemEvents.APP_PLUGINS_ADDED, expect.objectContaining({ tenantSlug: 'system', appKey: 'warehouse', pluginKeys: ['reports'] }));
    expect(events.emit).toHaveBeenCalledWith(SystemEvents.APP_PLUGINS_REMOVED, expect.objectContaining({ appKey: 'warehouse', pluginKeys: ['procurement'] }));
    expect(events.emit).toHaveBeenCalledWith(SystemEvents.APP_PRICING_UPDATED, expect.objectContaining({ appKey: 'warehouse', pluginKeys: [] }));
  });

  it('an update that only renames emits nothing', async () => {
    const { service, events } = setup();
    await service.create(warehouse());
    events.emit.mockClear();
    await service.update('warehouse', { name: 'Gudang', plugins: ['inventory', 'procurement'] });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('liveSubscribers counts tenants with a live subscription', async () => {
    const { service, addTenant } = setup();
    addTenant('acme', { pluginKey: 'app:warehouse', status: 'ACTIVE', trialEndsAt: null });
    addTenant('beta', { pluginKey: 'app:warehouse', status: 'ENDED', trialEndsAt: null });
    addTenant('gamma');
    await service.create(warehouse());
    await expect(service.get('warehouse')).resolves.toMatchObject({ liveSubscribers: 1 });
  });

  it('reads each tenant\'s app subscriptions in one query, however many apps there are', async () => {
    const { service, addTenant, clients } = setup();
    addTenant('acme', { pluginKey: 'app:warehouse', status: 'ACTIVE', trialEndsAt: null });
    addTenant('beta');
    await service.create(warehouse());
    await service.create(warehouse({ key: 'retail', name: 'Retail', plugins: ['inventory'] }));
    for (const client of Object.values(clients)) jest.mocked(client.tenantSubscription.findMany).mockClear();

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ key: 'retail', liveSubscribers: 0 }),
      expect.objectContaining({ key: 'warehouse', liveSubscribers: 1 }),
    ]);
    expect(clients.acme.tenantSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(clients.beta.tenantSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(clients.acme.tenantSubscription.findUnique).not.toHaveBeenCalled();
  });

  it('lists plugins that couldn\'t be switched on for a subscriber until they are on', async () => {
    const { db, service, addTenant, tenantPlugins } = setup();
    addTenant('acme', { pluginKey: 'app:warehouse', status: 'ACTIVE', trialEndsAt: null });
    addTenant('beta', { pluginKey: 'app:warehouse', status: 'ENDED', trialEndsAt: null });
    await service.create(warehouse());
    db.app.rows[0].switchOnFailures = [
      { tenantSlug: 'acme', pluginKey: 'procurement', error: 'hook failed', at: '2026-10-28T00:00:00.000Z' },
      // No longer holds the app: nothing to fix
      { tenantSlug: 'beta', pluginKey: 'procurement', error: 'hook failed', at: '2026-10-28T00:00:00.000Z' },
    ];
    tenantPlugins.acme.procurement = { key: 'procurement', isEnabled: false };

    await expect(service.get('warehouse')).resolves.toMatchObject({
      switchOnFailures: [{ tenantSlug: 'acme', pluginKey: 'procurement', pluginName: 'Procurement', error: 'hook failed', at: '2026-10-28T00:00:00.000Z' }],
    });

    // The tenant switched it on from Tenant Plugins
    tenantPlugins.acme.procurement.isEnabled = true;
    await expect(service.get('warehouse')).resolves.toMatchObject({ switchOnFailures: [] });
  });

  it('remove refuses while a tenant still has the app, then deletes it with its plugins', async () => {
    const { db, service, addTenant } = setup();
    addTenant('acme', { pluginKey: 'app:warehouse', status: 'PAUSED', trialEndsAt: null });
    await service.create(warehouse());
    await expect(service.remove('warehouse')).rejects.toThrow('Tenants still have this app. Hide it instead.');

    db.tenant.rows.length = 0;
    await service.remove('warehouse');
    expect(db.app.rows).toHaveLength(0);
    expect(db.appPlugin.rows).toHaveLength(0);
  });

  it('pluginOptions lists plugins with prices and dependencies', async () => {
    await expect(setup().service.pluginOptions()).resolves.toEqual(expect.arrayContaining([
      { key: 'procurement', name: 'Procurement', pricingModel: 'MONTHLY', price: '100000.00', currency: 'IDR', dependencies: ['inventory'] },
    ]));
  });

  it('rejects with BadRequest, not a crash', async () => {
    await expect(setup().service.create(warehouse({ plugins: ['nope'] }))).rejects.toBeInstanceOf(BadRequestException);
  });
});
