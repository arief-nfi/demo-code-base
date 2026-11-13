import { Test } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import {
  PrismaService,
  CacheService,
  PluginEventService,
  PluginMetricsService,
  PluginLockService,
  SystemEvents,
} from '@saas/backend';
import { PluginsService } from '../plugins/plugins.service';
import { SubscriptionsService } from './subscriptions.service';
import { InvoiceService } from './invoice.service';
import { CatalogService } from './catalog.service';
import { CreditService } from './credit.service';
import { CreditSettlementListener } from './credit-settlement.listener';
import { AppPluginsService } from './app-plugins.service';
import { BillingSettingsService } from './billing-settings.service';
import { FakePaymentProvider } from './providers/fake.provider';
import { BILLING_PROVIDER } from './providers/payment-provider';
import { createBillingDb, type BillingDb } from './testing/in-memory-billing-db';

// Mutable registry maps so tests can inject lifecycle hooks, manifests and permissions
const mockPluginLifecycles: Record<string, any> = {};
const mockPluginManifests: Record<string, any> = {};
const mockPluginPermissions: Record<string, any[]> = {};

jest.mock('../plugin-registry', () => ({
  PluginList: [],
  get PluginLifecycles() { return mockPluginLifecycles; },
  PluginConfigSchemas: {},
  get PluginManifests() { return mockPluginManifests; },
  get PluginPermissions() { return mockPluginPermissions; },
}));


describe('SubscriptionsService (billing lifecycle through the shared PluginsService core)', () => {
  let subscriptions: SubscriptionsService;
  let lock: PluginLockService;
  let pluginsCore: PluginsService;

  // --- In-memory fake of the public + tenant schemas ---
  let systemPlugins: Record<string, any>;
  let tenantPlugins: Record<string, any>;
  let subs: Record<string, any>;
  let billingDb: BillingDb;
  const roles: Record<string, { id: string; name: string }> = {
    ADMIN: { id: 'role-admin', name: 'ADMIN' },
    USER: { id: 'role-user', name: 'USER' },
  };

  const tenantClient = {
    plugin: {
      findUnique: jest.fn(async ({ where }: any) => tenantPlugins[where.key] ?? null),
      findMany: jest.fn(async ({ where }: any = {}) =>
        Object.values(tenantPlugins).filter((p: any) => where?.isEnabled === undefined || p.isEnabled === where.isEnabled),
      ),
      upsert: jest.fn(async ({ where, update, create }: any) =>
        (tenantPlugins[where.key] = tenantPlugins[where.key] ? { ...tenantPlugins[where.key], ...update } : { ...create })),
      update: jest.fn(async ({ where, data }: any) => {
        if (!tenantPlugins[where.key]) throw new Error('Record to update not found');
        return (tenantPlugins[where.key] = { ...tenantPlugins[where.key], ...data });
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!tenantPlugins[where.key]) return { count: 0 };
        tenantPlugins[where.key] = { ...tenantPlugins[where.key], ...data };
        return { count: 1 };
      }),
    },
    tenantSubscription: {
      findUnique: jest.fn(async ({ where }: any) => subs[where.pluginKey] ?? null),
      findMany: jest.fn(async ({ where }: any = {}) =>
        Object.values(subs).filter((s: any) => !where?.status || s.status === where.status),
      ),
      upsert: jest.fn(async ({ where, update, create }: any) =>
        (subs[where.pluginKey] = subs[where.pluginKey]
          ? { ...subs[where.pluginKey], ...update }
          : { id: 'sub-1', createdAt: new Date(), updatedAt: new Date(), ...create })),
      update: jest.fn(async ({ where, data }: any) => (subs[where.pluginKey] = { ...subs[where.pluginKey], ...data })),
      delete: jest.fn(async ({ where }: any) => {
        const row = subs[where.pluginKey];
        delete subs[where.pluginKey];
        return row;
      }),
    },
    permission: {
      upsert: jest.fn(),
      findMany: jest.fn(async ({ where }: any) => where.name.in.map((name: string) => ({ id: `id:${name}`, name }))),
    },
    role: {
      findFirst: jest.fn(async ({ where }: any) => roles[where.name] ?? null),
      update: jest.fn(),
    },
  };

  // Public schema: system plugins from `systemPlugins`; tenants, invoices and the counter from the billing fake
  const mockPrisma: any = {
    plugin: {
      findUnique: jest.fn(async ({ where }: any) => systemPlugins[where.key] ?? null),
      findMany: jest.fn(async () => Object.values(systemPlugins)),
    },
    get tenant() { return billingDb.tenant; },
    get invoice() { return billingDb.invoice; },
    get invoiceCounter() { return billingDb.invoiceCounter; },
    get paymentCheckout() { return billingDb.paymentCheckout; },
    get app() { return billingDb.app; },
    get appPlugin() { return billingDb.appPlugin; },
    get billingCredit() { return billingDb.billingCredit; },
    $executeRaw: async () => 0,
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma),
    getTenantClient: jest.fn(() => tenantClient),
  };
  const settingsView = {
    taxEnabled: false, taxName: 'PPN', taxRate: 11, renewalLeadDays: 7, graceDays: 7, checkoutValidHours: 24,
    sellerName: null, sellerAddress: null, sellerTaxId: null, sellerEmail: null,
  };
  const mockSettings = {
    getSettings: jest.fn(async () => settingsView),
    getProfile: jest.fn(async () => ({ companyName: null, billingEmail: null, address: null, taxId: null })),
  };
  const mockCache = { get: jest.fn(), set: jest.fn(), del: jest.fn().mockResolvedValue(undefined) };
  const mockEvents = { emit: jest.fn(), emitAsync: jest.fn() };
  const mockMetrics = { record: jest.fn() };

  const paidPlugin = (overrides: Record<string, unknown> = {}) => ({
    key: 'integration',
    name: 'Integration',
    description: 'Partners & webhooks',
    version: '1.0.0',
    authorName: null,
    authorEmail: null,
    authorUrl: null,
    isEnabled: true,
    pricingModel: 'MONTHLY',
    price: 10,
    pricingCurrency: 'USD',
    trialDays: 14,
    ...overrides,
  });
  const installedPlugin = (overrides: Record<string, unknown> = {}) => ({
    key: 'integration',
    isEnabled: true,
    installedAt: new Date('2024-01-01'),
    version: '1.0.0',
    config: { retentionDays: 30 },
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // clearAllMocks keeps implementations: a listener wired into emit by one test must not run in the next
    mockEvents.emit.mockReset();
    for (const map of [mockPluginLifecycles, mockPluginManifests, mockPluginPermissions]) {
      for (const key of Object.keys(map)) delete map[key];
    }
    systemPlugins = { integration: paidPlugin() };
    tenantPlugins = {};
    subs = {};
    billingDb = createBillingDb();
    billingDb.tenant.rows.push({ id: 't1', slug: 'acme', name: 'Acme Corp', status: 'ACTIVE' });
    await build(new FakePaymentProvider('http://web.test', 'secret'));
  });

  async function build(provider: FakePaymentProvider | null) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PluginsService,
        SubscriptionsService,
        PluginLockService,
        InvoiceService,
        CatalogService,
        CreditService,
        AppPluginsService,
        { provide: BillingSettingsService, useValue: mockSettings },
        { provide: BILLING_PROVIDER, useValue: provider },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
        { provide: PluginEventService, useValue: mockEvents },
        { provide: PluginMetricsService, useValue: mockMetrics },
      ],
    }).compile();

    subscriptions = moduleRef.get(SubscriptionsService);
    lock = moduleRef.get(PluginLockService);
    pluginsCore = moduleRef.get(PluginsService);
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const sub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1', pluginKey: 'integration', status: 'ACTIVE', pricingModel: 'MONTHLY', price: 10, currency: 'USD',
    startDate: new Date('2026-09-20'), endDate: null, trialEndsAt: null, cancelledAt: null, subscribedBy: null,
    currentPeriodStart: new Date('2026-09-20'), currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS),
    cancelAtPeriodEnd: false, pastDueAt: null, pausedAt: null, endedAt: null,
    createdAt: new Date('2026-09-20'), updatedAt: new Date('2026-09-20'),
    ...overrides,
  });
  const openInvoice = async (kind: 'FIRST' | 'RENEWAL' | 'TRIAL_CONVERSION' | 'ONE_TIME' = 'FIRST', anchor = new Date()) =>
    (await moduleInvoices().issueInvoice({
      tenantId: 't1', tenantSlug: 'acme', pluginKey: 'integration', kind, anchor, periodStart: null, periodEnd: null,
      dueAt: new Date(anchor.getTime() + DAY_MS),
    })).invoice;
  // InvoiceService over the same fake, for arranging invoices
  const moduleInvoices = () => new InvoiceService(mockPrisma, mockSettings as any, new CatalogService(mockPrisma), new CreditService(mockPrisma));

  describe('subscribe', () => {
    it('should enable a trial exactly like toggle does: onInstall, default config, ADMIN-only permissions', async () => {
      const onInstall = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles.integration = { onInstall, getDefaultConfig: () => ({ retentionDays: 30 }) };
      mockPluginPermissions.integration = [
        { name: 'integration.webhook.read', description: 'Read webhooks' },
        { name: 'integration.webhook.write', description: 'Write webhooks' },
      ];

      const { subscription, invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration', 'user-1');

      expect(subscription.status).toBe('TRIAL');
      expect(invoiceId).toBeNull();
      expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: 'acme', pluginKey: 'integration' }));
      expect(tenantPlugins.integration).toEqual(
        expect.objectContaining({ isEnabled: true, config: { retentionDays: 30 }, installedAt: expect.any(Date) }),
      );
      expect(tenantClient.role.update).toHaveBeenCalledTimes(1);
      expect(tenantClient.role.update).toHaveBeenCalledWith({
        where: { id: 'role-admin' },
        data: { permissions: { connect: [{ id: 'id:integration.webhook.read' }, { id: 'id:integration.webhook.write' }] } },
      });
      expect(mockCache.del).toHaveBeenCalledWith('plugin:tenant:acme:integration');
      expect(mockEvents.emit).toHaveBeenCalledWith(SystemEvents.PLUGIN_ENABLED_TENANT, expect.anything());
    });

    it('should hold the toggle lock once and run the core inside it (no re-entrant deadlock)', async () => {
      const withLock = jest.spyOn(lock, 'withLock');

      await subscriptions.subscribe('acme', 't1', 'integration');

      expect(withLock).toHaveBeenCalledTimes(1);
      expect(withLock).toHaveBeenCalledWith('toggle:acme:integration', expect.any(Function));
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });

    it('should enforce plugin dependencies and drop the new subscription when enabling fails', async () => {
      mockPluginManifests.integration = { pluginDependencies: { 'audit-log': '>=1.0.0' } };

      await expect(subscriptions.subscribe('acme', 't1', 'integration')).rejects.toThrow(
        'required dependencies not enabled: audit-log',
      );

      expect(tenantPlugins.integration).toBeUndefined();
      expect(subs.integration).toBeUndefined();
    });

    it('should restore a previous (ended) subscription when enabling fails', async () => {
      const ended = sub({ status: 'ENDED', trialEndsAt: null, cancelledAt: new Date('2024-01-10'), subscribedBy: 'user-0' });
      subs.integration = { ...ended };
      tenantPlugins.integration = installedPlugin({ isEnabled: false });
      mockPluginLifecycles.integration = { onActivate: jest.fn().mockRejectedValue(new Error('boom')) };

      await expect(subscriptions.subscribe('acme', 't1', 'integration', 'user-1')).rejects.toThrow(BadRequestException);

      expect(subs.integration).toEqual(expect.objectContaining({ status: 'ENDED', cancelledAt: ended.cancelledAt, subscribedBy: 'user-0' }));
      expect(tenantPlugins.integration.isEnabled).toBe(false);
    });

    it('subscribe to a paid plugin without trial creates PENDING_PAYMENT and a FIRST invoice due in 24h, and returns its invoiceId', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      const before = Date.now();

      const { subscription, invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');

      expect(subscription.status).toBe('PENDING_PAYMENT');
      expect(tenantPlugins.integration).toBeUndefined();
      const [invoice] = billingDb.invoice.rows;
      expect(invoiceId).toBe(invoice.id);
      expect(invoice).toMatchObject({ kind: 'FIRST', status: 'OPEN', tenantId: 't1', pluginKey: 'integration', total: '10.00', currency: 'USD' });
      expect(invoice.dueAt.getTime() - before).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
      expect(invoice.dueAt.getTime() - before).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
      expect(mockEvents.emit).toHaveBeenCalledWith(SystemEvents.BILLING_INVOICE_ISSUED, expect.objectContaining({ invoiceId: invoice.id }));
    });

    it('subscribe to a one-time plugin issues a ONE_TIME invoice', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0, pricingModel: 'ONE_TIME', price: 50 });

      await subscriptions.subscribe('acme', 't1', 'integration');

      expect(billingDb.invoice.rows[0]).toMatchObject({ kind: 'ONE_TIME', pricingModel: 'ONE_TIME', total: '50.00' });
    });

    it('subscribe to a paid plugin 503s when no provider', async () => {
      await build(null);
      systemPlugins.integration = paidPlugin({ trialDays: 0 });

      await expect(subscriptions.subscribe('acme', 't1', 'integration')).rejects.toThrow(ServiceUnavailableException);
      expect(subs.integration).toBeUndefined();
      expect(billingDb.invoice.rows).toHaveLength(0);
    });

    it('a trial also needs a payment provider (no paid plugins at all until one exists)', async () => {
      await build(null);
      await expect(subscriptions.subscribe('acme', 't1', 'integration')).rejects.toThrow(ServiceUnavailableException);
      expect(subs.integration).toBeUndefined();
      expect(tenantPlugins.integration).toBeUndefined();
    });

    it('free plugins still work with no provider', async () => {
      await build(null);
      systemPlugins.integration = paidPlugin({ pricingModel: 'FREE', price: null, trialDays: 0 });
      const { subscription } = await subscriptions.subscribe('acme', 't1', 'integration');
      expect(subscription.status).toBe('ACTIVE');
    });

    it('subscribing again while the first invoice is unpaid returns that same invoice', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      const first = await subscriptions.subscribe('acme', 't1', 'integration');
      const again = await subscriptions.subscribe('acme', 't1', 'integration');

      expect(again.invoiceId).toBe(first.invoiceId);
      expect(billingDb.invoice.rows).toHaveLength(1);
    });
    it('subscribing while PAUSED returns its open invoice instead of starting over', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      subs.integration = sub({ status: 'PAUSED', pausedAt: new Date() });
      const invoice = await openInvoice('RENEWAL', subs.integration.currentPeriodEnd);

      const again = await subscriptions.subscribe('acme', 't1', 'integration');

      expect(again.invoiceId).toBe(invoice.id);
      expect(subs.integration.status).toBe('PAUSED');
      expect(billingDb.invoice.rows).toHaveLength(1);
    });
  });

  describe('rollback when the core fails after the plugin row was written', () => {
    beforeEach(() => {
      mockPluginPermissions.integration = [{ name: 'integration.webhook.read', description: 'Read webhooks' }];
      // Permission seeding runs after the tenant plugin upsert (isEnabled: true) inside the core
      tenantClient.permission.upsert.mockRejectedValueOnce(new Error('db down'));
    });

    it('subscribe: should drop the subscription AND switch the plugin back off', async () => {
      await expect(subscriptions.subscribe('acme', 't1', 'integration')).rejects.toThrow('db down');

      expect(subs.integration).toBeUndefined();
      expect(tenantPlugins.integration.isEnabled).toBe(false);
      expect(mockCache.del).toHaveBeenCalledWith('plugin:tenant:acme:integration');
    });

    it('should leave a plugin that was already enabled before in its previous (enabled) state', async () => {
      tenantPlugins.integration = installedPlugin({ isEnabled: true });

      await expect(subscriptions.subscribe('acme', 't1', 'integration')).rejects.toThrow('db down');

      expect(subs.integration).toBeUndefined();
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });
  });

  describe('subscribe — one trial per plugin', () => {
    const usedTrialEnd = new Date('2024-01-15');

    it.each(['EXPIRED', 'CANCELLED', 'ENDED'])(
      'should not grant a second trial after a %s subscription that already had one',
      async (status) => {
        subs.integration = sub({ status, trialEndsAt: usedTrialEnd });

        const { subscription } = await subscriptions.subscribe('acme', 't1', 'integration', 'user-1');

        expect(subscription.status).toBe('PENDING_PAYMENT');
        expect(subscription.trialEndsAt).toEqual(usedTrialEnd); // evidence of the used trial is kept
        expect(tenantPlugins.integration).toBeUndefined();
      },
    );

    it('should keep refusing a new trial across repeated re-subscribes', async () => {
      subs.integration = sub({ status: 'ENDED', trialEndsAt: usedTrialEnd });

      await subscriptions.subscribe('acme', 't1', 'integration');
      await subscriptions.cancel('acme', 't1', 'integration');
      const { subscription } = await subscriptions.subscribe('acme', 't1', 'integration');

      expect(subscription.status).toBe('PENDING_PAYMENT');
      expect(tenantPlugins.integration).toBeUndefined();
    });

    it('should still grant a trial when an earlier subscription never had one', async () => {
      subs.integration = sub({ status: 'ENDED', trialEndsAt: null });

      const { subscription } = await subscriptions.subscribe('acme', 't1', 'integration');

      expect(subscription.status).toBe('TRIAL');
      expect(subscription.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });

    it('should keep FREE plugins ACTIVE regardless of an earlier trial', async () => {
      systemPlugins.integration = paidPlugin({ pricingModel: 'FREE', price: null, trialDays: 0 });
      subs.integration = sub({ status: 'ENDED', trialEndsAt: usedTrialEnd });

      const { subscription } = await subscriptions.subscribe('acme', 't1', 'integration');

      expect(subscription.status).toBe('ACTIVE');
      expect(subscription.currentPeriodEnd).toBeNull();
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });
  });

  describe('cancel / resume', () => {
    it('cancel ACTIVE schedules the end and keeps the plugin on', async () => {
      subs.integration = sub();
      tenantPlugins.integration = installedPlugin();

      const result = await subscriptions.cancel('acme', 't1', 'integration');

      expect(result).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });

    it('resume clears the scheduled end', async () => {
      subs.integration = sub({ cancelAtPeriodEnd: true, cancelledAt: new Date() });

      const result = await subscriptions.resume('acme', 'integration');

      expect(result).toMatchObject({ cancelAtPeriodEnd: false, cancelledAt: null });
    });

    it("resume refuses when an administrator voided this period's renewal (no dead end with nothing to pay)", async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      subs.integration = sub();
      tenantPlugins.integration = installedPlugin();
      const renewal = await openInvoice('RENEWAL', subs.integration.currentPeriodEnd);
      await subscriptions.voidInvoice(renewal.id);
      expect(subs.integration.cancelAtPeriodEnd).toBe(true);

      await expect(subscriptions.resume('acme', 'integration')).rejects.toThrow(/voided/);
      expect(subs.integration.cancelAtPeriodEnd).toBe(true);
      expect((await subscriptions.tenantSubscriptions('acme', 't1'))[0].resumable).toBe(false);
    });

    it('a tenant-scheduled cancel is resumable', async () => {
      subs.integration = sub({ cancelAtPeriodEnd: true, cancelledAt: new Date() });
      expect((await subscriptions.tenantSubscriptions('acme', 't1'))[0].resumable).toBe(true);
    });

    it('resume refuses when nothing is scheduled or the period is over', async () => {
      subs.integration = sub();
      await expect(subscriptions.resume('acme', 'integration')).rejects.toThrow(BadRequestException);
      subs.integration = sub({ cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() - DAY_MS) });
      await expect(subscriptions.resume('acme', 'integration')).rejects.toThrow(BadRequestException);
    });

    it('cancel during TRIAL ends now, voids its open invoice, and disables through the core', async () => {
      subs.integration = sub({ status: 'TRIAL', trialEndsAt: new Date(Date.now() + 3 * DAY_MS), currentPeriodEnd: null });
      tenantPlugins.integration = installedPlugin();
      const onDeactivate = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles.integration = { onDeactivate };
      const invoice = await openInvoice('TRIAL_CONVERSION');

      const result = await subscriptions.cancel('acme', 't1', 'integration');

      expect(result.status).toBe('ENDED');
      expect(onDeactivate).toHaveBeenCalled();
      expect(tenantPlugins.integration.isEnabled).toBe(false);
      expect(billingDb.invoice.rows.find((i) => i.id === invoice.id)?.status).toBe('VOID');
      expect(mockEvents.emit).toHaveBeenCalledWith(SystemEvents.PLUGIN_DISABLED_TENANT, expect.anything());
    });

    it('should refuse to end a trial while other enabled plugins depend on it, keeping the subscription', async () => {
      subs.integration = sub({ status: 'TRIAL', trialEndsAt: new Date(Date.now() + 3 * DAY_MS) });
      tenantPlugins.integration = installedPlugin();
      tenantPlugins['crm'] = { key: 'crm', isEnabled: true };
      mockPluginManifests['crm'] = { pluginDependencies: { integration: '>=1.0.0' } };

      await expect(subscriptions.cancel('acme', 't1', 'integration')).rejects.toThrow('other enabled plugins depend on it: crm');

      expect(subs.integration.status).toBe('TRIAL');
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });

    it('cancel while PENDING_PAYMENT ends it, voids the invoice, and leaves plugin state alone', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      await subscriptions.subscribe('acme', 't1', 'integration');

      const result = await subscriptions.cancel('acme', 't1', 'integration');

      expect(result.status).toBe('ENDED');
      expect(billingDb.invoice.rows[0].status).toBe('VOID');
      expect(tenantClient.plugin.upsert).not.toHaveBeenCalled();
    });

    it('a paid one-time purchase cannot be cancelled', async () => {
      subs.integration = sub({ pricingModel: 'ONE_TIME', currentPeriodEnd: null });
      await expect(subscriptions.cancel('acme', 't1', 'integration')).rejects.toThrow(BadRequestException);
    });
  });

  describe('activateFromPayment', () => {
    const pay = (invoiceId: string, paidAt = new Date()) =>
      subscriptions.activateFromPayment(invoiceId, { paidAt, provider: 'fake', method: 'BANK_TRANSFER', reference: 'ref-1', complimentary: false });

    beforeEach(() => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
    });

    it('activateFromPayment enables a PENDING_PAYMENT subscription for one period', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      const paidAt = new Date('2026-10-20T10:00:00Z');

      await pay(invoiceId!, paidAt);

      expect(billingDb.invoice.rows[0]).toMatchObject({
        status: 'PAID', paidAt, paymentProvider: 'fake', paymentReference: 'ref-1',
        periodStart: paidAt, periodEnd: new Date('2026-11-20T10:00:00Z'),
      });
      expect(subs.integration).toMatchObject({
        status: 'ACTIVE', currentPeriodStart: paidAt, currentPeriodEnd: new Date('2026-11-20T10:00:00Z'), lastPaymentDate: paidAt,
      });
      expect(tenantPlugins.integration.isEnabled).toBe(true);
      expect(mockEvents.emit).toHaveBeenCalledWith(SystemEvents.BILLING_INVOICE_PAID, expect.objectContaining({ invoiceId }));
    });

    it("paying a renewal leaves a plugin the tenant switched off alone (only first payment / resume switch on)", async () => {
      subs.integration = sub();
      tenantPlugins.integration = installedPlugin({ isEnabled: false });
      const renewal = await openInvoice('RENEWAL', subs.integration.currentPeriodEnd);

      await pay(renewal.id);

      expect(subs.integration.status).toBe('ACTIVE');
      expect(tenantPlugins.integration.isEnabled).toBe(false);
    });

    it('paying for a PAUSED plan switches the plugin back on', async () => {
      subs.integration = sub({ status: 'PAUSED', pausedAt: new Date() });
      tenantPlugins.integration = installedPlugin({ isEnabled: false });
      const renewal = await openInvoice('RENEWAL', subs.integration.currentPeriodEnd);

      await pay(renewal.id);

      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });

    it('two PAID activations for one invoice extend the period once', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      const paidAt = new Date('2026-10-20T10:00:00Z');

      await Promise.all([pay(invoiceId!, paidAt), pay(invoiceId!, new Date('2026-10-21T10:00:00Z'))]);

      expect(subs.integration.currentPeriodEnd).toEqual(new Date('2026-11-20T10:00:00Z'));
      expect(mockEvents.emit.mock.calls.filter(([e]) => e === SystemEvents.BILLING_INVOICE_PAID)).toHaveLength(1);
      expect(billingDb.invoice.rows[0].activationError).toBe('paid_twice');
    });

    it('a second payment for an already-paid invoice is flagged paid_twice and changes nothing else', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      await pay(invoiceId!, new Date('2026-10-20T10:00:00Z'));
      const before = { ...subs.integration };

      await pay(invoiceId!, new Date('2026-10-25T10:00:00Z'));

      expect(billingDb.invoice.rows[0]).toMatchObject({ status: 'PAID', paidAt: new Date('2026-10-20T10:00:00Z'), activationError: 'paid_twice' });
      expect(subs.integration.currentPeriodEnd).toEqual(before.currentPeriodEnd);
    });

    it('an invoice voided between the read and the claim is flagged paid_after_void', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      const realUpdateMany = billingDb.invoice.updateMany.bind(billingDb.invoice);
      billingDb.invoice.updateMany = (async (args: any) => {
        billingDb.invoice.rows[0].status = 'VOID'; // a concurrent void wins the race
        return realUpdateMany(args);
      }) as any;

      await pay(invoiceId!);

      expect(billingDb.invoice.rows[0]).toMatchObject({ status: 'VOID', activationError: 'paid_after_void' });
      expect(subs.integration.status).toBe('PENDING_PAYMENT');
    });

    it('a subscription write failure after the invoice is paid is recorded, not lost', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      tenantClient.tenantSubscription.upsert.mockRejectedValueOnce(new Error('tenant schema unavailable'));

      await expect(pay(invoiceId!)).resolves.toBeUndefined();

      expect(billingDb.invoice.rows[0].status).toBe('PAID');
      expect(billingDb.invoice.rows[0].activationError).toContain('tenant schema unavailable');
      expect(mockEvents.emit).toHaveBeenCalledWith(SystemEvents.BILLING_ACTIVATION_FAILED, expect.objectContaining({ invoiceId }));
    });

    it("paying an invoice expires its other pending payment links", async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      billingDb.paymentCheckout.rows.push({ id: 'c-2', invoiceId, provider: 'fake', externalId: 'fake_c-2', url: 'x', status: 'PENDING', expiresAt: new Date(Date.now() + DAY_MS) });

      await pay(invoiceId!);

      expect(billingDb.paymentCheckout.rows.find((c) => c.id === 'c-2')?.status).toBe('EXPIRED');
    });

    it('enable failure after payment keeps the invoice PAID and the subscription ACTIVE and records activationError', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      mockPluginManifests.integration = { pluginDependencies: { 'audit-log': '>=1.0.0' } };

      await pay(invoiceId!);

      expect(billingDb.invoice.rows[0].status).toBe('PAID');
      expect(billingDb.invoice.rows[0].activationError).toContain('audit-log');
      expect(subs.integration.status).toBe('ACTIVE');
      expect(mockEvents.emit).toHaveBeenCalledWith(SystemEvents.BILLING_ACTIVATION_FAILED, expect.objectContaining({ invoiceId }));
    });

    it('a payment for a VOID invoice records activationError and changes nothing else', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      billingDb.invoice.rows[0].status = 'VOID';

      await pay(invoiceId!);

      expect(billingDb.invoice.rows[0]).toMatchObject({ status: 'VOID', activationError: 'paid_after_void' });
      expect(subs.integration.status).toBe('PENDING_PAYMENT');
      expect(tenantPlugins.integration).toBeUndefined();
    });
  });

  describe('voidInvoice / markPaid', () => {
    beforeEach(() => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
    });

    it('voiding an invoice that used credit gives it back', async () => {
      const credits = new CreditService(mockPrisma);
      await credits.grant({ tenantId: 't1', currency: 'USD', amount: '4.00', reason: 'Unused time', sourceKey: 'docs' });
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      expect(billingDb.invoice.rows[0]).toMatchObject({ creditAmount: '4.00', total: '6.00' });
      await expect(credits.balance('t1', 'USD')).resolves.toBe('0.00');

      await subscriptions.voidInvoice(invoiceId!);

      await expect(credits.balance('t1', 'USD')).resolves.toBe('4.00');
    });

    it('void FIRST ends the subscription', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');

      await subscriptions.voidInvoice(invoiceId!);

      expect(billingDb.invoice.rows[0].status).toBe('VOID');
      expect(subs.integration.status).toBe('ENDED');
    });

    it('voiding an invoice expires its pending payment links', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      billingDb.paymentCheckout.rows.push({ id: 'c-1', invoiceId, provider: 'fake', externalId: 'fake_c-1', url: 'x', status: 'PENDING', expiresAt: new Date(Date.now() + DAY_MS) });

      await subscriptions.voidInvoice(invoiceId!);

      expect(billingDb.paymentCheckout.rows[0].status).toBe('EXPIRED');
    });

    it('cancelling expires the payment links of the invoices it voids', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      billingDb.paymentCheckout.rows.push({ id: 'c-1', invoiceId, provider: 'fake', externalId: 'fake_c-1', url: 'x', status: 'PENDING', expiresAt: new Date(Date.now() + DAY_MS) });

      await subscriptions.cancel('acme', 't1', 'integration');

      expect(billingDb.paymentCheckout.rows[0].status).toBe('EXPIRED');
    });

    it('void RENEWAL schedules the end', async () => {
      subs.integration = sub();
      tenantPlugins.integration = installedPlugin();
      const invoice = await openInvoice('RENEWAL', subs.integration.currentPeriodEnd);

      await subscriptions.voidInvoice(invoice.id);

      expect(subs.integration).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });

    it('void RENEWAL after the period ended ends it now', async () => {
      subs.integration = sub({ status: 'PAST_DUE', currentPeriodEnd: new Date(Date.now() - DAY_MS) });
      tenantPlugins.integration = installedPlugin();
      const invoice = await openInvoice('RENEWAL', subs.integration.currentPeriodEnd);

      await subscriptions.voidInvoice(invoice.id);

      expect(subs.integration.status).toBe('ENDED');
      expect(tenantPlugins.integration.isEnabled).toBe(false);
    });

    it('markPaid complimentary flags the invoice', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');

      const invoice = await subscriptions.markPaid(invoiceId!, { method: 'complimentary', reference: 'partner deal' });

      expect(invoice).toMatchObject({ status: 'PAID', complimentary: true, paymentProvider: 'manual', paymentMethod: 'complimentary', paymentReference: 'partner deal' });
      expect(subs.integration.status).toBe('ACTIVE');
    });

    it('markPaid refuses an invoice that is not open', async () => {
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      billingDb.invoice.rows[0].status = 'VOID';
      await expect(subscriptions.markPaid(invoiceId!, { method: 'bank_transfer' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('tenantSubscriptions', () => {
    it('shows one-time purchases as OWNED and the next invoice date for renewals', async () => {
      const end = new Date(Date.now() + 20 * DAY_MS);
      subs.integration = sub({ currentPeriodEnd: end });
      subs.docs = sub({ pluginKey: 'docs', pricingModel: 'ONE_TIME', currentPeriodEnd: null });
      systemPlugins.docs = paidPlugin({ key: 'docs', name: 'Document Templates', pricingModel: 'ONE_TIME' });

      const rows = await subscriptions.tenantSubscriptions('acme', 't1');

      expect(rows.find((r) => r.pluginKey === 'integration')).toMatchObject({
        pluginName: 'Integration', displayStatus: 'ACTIVE', nextInvoiceAt: new Date(end.getTime() - 7 * DAY_MS),
      });
      expect(rows.find((r) => r.pluginKey === 'docs')).toMatchObject({ pluginName: 'Document Templates', displayStatus: 'OWNED', nextInvoiceAt: null });
    });
  });

  describe('pricing changes', () => {
    const NOW = new Date('2026-10-20T00:00:00Z');

    it('free→paid gives tenants using the plugin a 14-day trial when trialDays is 0', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      tenantPlugins.integration = installedPlugin({ isEnabled: true });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration).toMatchObject({ status: 'TRIAL', pricingModel: 'MONTHLY', trialEndsAt: new Date('2026-11-03T00:00:00Z') });
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });

    it("free→paid uses the plugin's trialDays when set", async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 30 });
      tenantPlugins.integration = installedPlugin({ isEnabled: true });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration.trialEndsAt).toEqual(new Date('2026-11-19T00:00:00Z'));
    });

    it('free→paid also converts a subscription row created while the plugin was free', async () => {
      tenantPlugins.integration = installedPlugin({ isEnabled: true });
      subs.integration = sub({ pricingModel: 'FREE', currentPeriodEnd: null });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration.status).toBe('TRIAL');
    });

    it('free→paid leaves tenants who have it switched off alone', async () => {
      tenantPlugins.integration = installedPlugin({ isEnabled: false });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration).toBeUndefined();
    });

    it('free→paid leaves a tenant that already pays alone', async () => {
      tenantPlugins.integration = installedPlugin({ isEnabled: true });
      subs.integration = sub();

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration.status).toBe('ACTIVE');
      expect(subs.integration.pricingModel).toBe('MONTHLY');
    });

    it('paid→free voids open invoices and makes subscriptions ACTIVE without an end', async () => {
      subs.integration = sub({ status: 'PAST_DUE', pastDueAt: NOW });
      tenantPlugins.integration = installedPlugin();
      const invoice = await openInvoice('RENEWAL');
      systemPlugins.integration = paidPlugin({ pricingModel: 'FREE', price: null, trialDays: 0 });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(billingDb.invoice.rows.find((i) => i.id === invoice.id)?.status).toBe('VOID');
      expect(subs.integration).toMatchObject({ status: 'ACTIVE', pricingModel: 'FREE', currentPeriodEnd: null, pastDueAt: null, cancelAtPeriodEnd: false });
    });

    it('paid→free switches a PAUSED plugin back on', async () => {
      subs.integration = sub({ status: 'PAUSED', pausedAt: NOW });
      tenantPlugins.integration = installedPlugin({ isEnabled: false });
      systemPlugins.integration = paidPlugin({ pricingModel: 'FREE', price: null, trialDays: 0 });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration).toMatchObject({ status: 'ACTIVE', pricingModel: 'FREE', pausedAt: null });
      expect(tenantPlugins.integration.isEnabled).toBe(true);
    });

    it('paid→free also converts subscriptions of suspended tenants (they come back to a free plugin, not a paused one)', async () => {
      billingDb.tenant.rows[0].status = 'SUSPENDED';
      subs.integration = sub({ status: 'PAUSED', pausedAt: NOW });
      systemPlugins.integration = paidPlugin({ pricingModel: 'FREE', price: null, trialDays: 0 });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration).toMatchObject({ status: 'ACTIVE', pricingModel: 'FREE' });
    });

    it('paid→free skips terminated tenants', async () => {
      billingDb.tenant.rows[0].status = 'TERMINATED';
      subs.integration = sub({ status: 'PAUSED', pausedAt: NOW });
      systemPlugins.integration = paidPlugin({ pricingModel: 'FREE', price: null, trialDays: 0 });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration.status).toBe('PAUSED');
    });

    it('paid→free leaves ENDED subscriptions ended', async () => {
      subs.integration = sub({ status: 'ENDED' });
      systemPlugins.integration = paidPlugin({ pricingModel: 'FREE', price: null, trialDays: 0 });

      await subscriptions.applyPricingChange('integration', NOW);

      expect(subs.integration.status).toBe('ENDED');
    });
  });

  describe('credit settlement', () => {
    const flush = async () => {
      for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    };

    it('a fully credited invoice issued inside the product lock settles after the lock is released', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      const listener = new CreditSettlementListener(mockPrisma, subscriptions);
      // Like EventEmitter2: listeners are called but not awaited
      mockEvents.emit.mockImplementation((event: string, payload: any) => {
        if (event === SystemEvents.BILLING_INVOICE_ISSUED) void listener.onIssued(payload);
      });
      await new CreditService(mockPrisma).grant({ tenantId: 't1', currency: 'USD', amount: '10.00', reason: 'Unused time', sourceKey: 'docs' });

      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      await flush();
      await lock.withLock('toggle:acme:integration', async () => undefined);

      const invoice = billingDb.invoice.rows.find((i) => i.id === invoiceId);
      expect(invoice).toMatchObject({ total: '0.00', status: 'PAID', paymentProvider: 'credit' });
      expect(subs.integration.status).toBe('ACTIVE');
    });

    it('settling it from credit twice (the listener and the job\'s backstop) is one settlement, not a payment to flag', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      await new CreditService(mockPrisma).grant({ tenantId: 't1', currency: 'USD', amount: '10.00', reason: 'Unused time', sourceKey: 'docs' });
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      const settle = () => subscriptions.activateFromPayment(invoiceId!, { paidAt: new Date(), provider: 'credit', method: 'credit', complimentary: false });

      await Promise.all([settle(), settle()]);

      expect(billingDb.invoice.rows.find((i) => i.id === invoiceId)).toMatchObject({ status: 'PAID', paymentProvider: 'credit', activationError: null });
      expect(mockEvents.emit.mock.calls.filter(([event]) => event === SystemEvents.BILLING_INVOICE_PAID)).toHaveLength(1);
    });

    it('a real payment for an invoice already settled from credit is still flagged', async () => {
      systemPlugins.integration = paidPlugin({ trialDays: 0 });
      await new CreditService(mockPrisma).grant({ tenantId: 't1', currency: 'USD', amount: '10.00', reason: 'Unused time', sourceKey: 'docs' });
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'integration');
      await subscriptions.activateFromPayment(invoiceId!, { paidAt: new Date(), provider: 'credit', method: 'credit', complimentary: false });

      await subscriptions.activateFromPayment(invoiceId!, { paidAt: new Date(), provider: 'fake', complimentary: false });

      expect(billingDb.invoice.rows.find((i) => i.id === invoiceId)?.activationError).toBe('paid_twice');
    });
  });

  describe('apps', () => {
    const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
    const pay = (invoiceId: string, paidAt = new Date()) =>
      subscriptions.activateFromPayment(invoiceId, { paidAt, provider: 'fake', complimentary: false });

    beforeEach(() => {
      systemPlugins = {
        inventory: paidPlugin({ key: 'inventory', name: 'Inventory', price: 150000, pricingCurrency: 'IDR', trialDays: 0 }),
        procurement: paidPlugin({ key: 'procurement', name: 'Procurement', price: 100000, pricingCurrency: 'IDR', trialDays: 0 }),
      };
      mockPluginManifests.procurement = { pluginDependencies: { inventory: '^1.0.0' } };
      billingDb.app.rows.push({ id: 'app-1', key: 'warehouse', name: 'Warehouse', isPublished: true, pricingModel: 'MONTHLY', price: '200000.00', pricingCurrency: 'IDR', trialDays: 0, icon: 'warehouse' });
      billingDb.appPlugin.rows.push({ appId: 'app-1', pluginKey: 'inventory', position: 0 }, { appId: 'app-1', pluginKey: 'procurement', position: 1 });
    });

    it('subscribing to a paid app issues a first invoice for app:warehouse', async () => {
      const { subscription, invoiceId, failedPlugins } = await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      expect(subscription.status).toBe('PENDING_PAYMENT');
      expect(failedPlugins).toEqual([]);
      expect(billingDb.invoice.rows.find((i) => i.id === invoiceId)).toMatchObject({ pluginKey: 'app:warehouse', pluginName: 'Warehouse', subtotal: '200000' });
      expect(tenantPlugins.inventory?.isEnabled ?? false).toBe(false);
    });

    it('paying it switches the plugins on, dependencies first, and records what it grants', async () => {
      const toggle = jest.spyOn(pluginsCore, 'toggleTenant');
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      await pay(invoiceId!);

      expect(toggle.mock.calls.map((call) => call[1])).toEqual(['inventory', 'procurement']);
      expect(subs['app:warehouse']).toMatchObject({ status: 'ACTIVE', grantedPlugins: ['inventory', 'procurement'] });
      expect(tenantPlugins.inventory.isEnabled).toBe(true);
      expect(tenantPlugins.procurement.isEnabled).toBe(true);
      expect(billingDb.invoice.rows.find((i) => i.id === invoiceId)?.activationError).toBeNull();
    });

    it('an own monthly plugin is replaced with credit and stays on', async () => {
      subs.inventory = sub({ pluginKey: 'inventory', price: 150000, currency: 'IDR', currentPeriodStart: d('2026-11-01'), currentPeriodEnd: d('2026-12-01') });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      billingDb.invoice.rows.push({
        id: 'own-paid', number: 'INV-2026-0900', dedupeKey: 'own-paid', tenantId: 't1', tenantSlug: 'acme', pluginKey: 'inventory', pluginName: 'Inventory',
        kind: 'FIRST', pricingModel: 'MONTHLY', periodStart: d('2026-11-01'), periodEnd: d('2026-12-01'), currency: 'IDR',
        subtotal: '150000', total: '150000', status: 'PAID', complimentary: false,
      });
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      await pay(invoiceId!, d('2026-11-16'));

      expect(subs.inventory).toMatchObject({ status: 'ENDED' });
      expect(tenantPlugins.inventory.isEnabled).toBe(true);
      await expect(new CreditService(mockPrisma).balance('t1', 'IDR')).resolves.toBe('75000');
      expect(mockEvents.emit).toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_REPLACED, expect.objectContaining({
        tenantSlug: 'acme', pluginKey: 'inventory', pluginName: 'Inventory', appKey: 'warehouse', appName: 'Warehouse', outcome: 'end-with-credit', credit: '75000', currency: 'IDR',
      }));
    });

    it('an own plugin in another currency stops renewing instead', async () => {
      subs.inventory = sub({ pluginKey: 'inventory', currency: 'USD' });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      await pay(invoiceId!);

      expect(subs.inventory).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
      await expect(new CreditService(mockPrisma).balances('t1')).resolves.toEqual([]);
    });

    it('an owned one-time plugin is untouched', async () => {
      subs.inventory = sub({ pluginKey: 'inventory', pricingModel: 'ONE_TIME', currentPeriodEnd: null, currency: 'IDR' });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      const before = { ...subs.inventory };
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      await pay(invoiceId!);

      expect(subs.inventory).toEqual(before);
      expect(mockEvents.emit).not.toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_REPLACED, expect.anything());
    });

    it('buying a plugin a live app grants is refused', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });

      await expect(subscriptions.subscribe('acme', 't1', 'inventory')).rejects.toThrow('"Inventory" is included in your Warehouse app.');
    });

    it('a free app switches its plugins on at subscribe and reports failures without rolling back', async () => {
      Object.assign(billingDb.app.rows[0], { pricingModel: 'FREE', price: null });
      const original = pluginsCore.toggleTenant.bind(pluginsCore);
      jest.spyOn(pluginsCore, 'toggleTenant').mockImplementation(async (slug, key, on) => {
        if (key === 'procurement') throw new Error('hook failed');
        return original(slug, key, on);
      });

      const { subscription, failedPlugins } = await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      expect(subscription).toMatchObject({ status: 'ACTIVE', grantedPlugins: ['inventory', 'procurement'] });
      expect(failedPlugins).toEqual(['procurement']);
      expect(tenantPlugins.inventory.isEnabled).toBe(true);
    });

    it('a second app sharing a plugin can be bought', async () => {
      subs['app:retail'] = sub({ pluginKey: 'app:retail', currency: 'IDR', grantedPlugins: ['inventory'] });

      await expect(subscriptions.subscribe('acme', 't1', 'app:warehouse')).resolves.toMatchObject({ subscription: expect.objectContaining({ status: 'PENDING_PAYMENT' }) });
    });

    it('cancelling an app on trial ends it now and switches its plugins off', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', status: 'TRIAL', trialEndsAt: new Date(Date.now() + 5 * DAY_MS), currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      tenantPlugins.procurement = installedPlugin({ key: 'procurement' });

      await subscriptions.cancel('acme', 't1', 'app:warehouse');

      expect(subs['app:warehouse'].status).toBe('ENDED');
      expect(tenantPlugins.inventory.isEnabled).toBe(false);
      expect(tenantPlugins.procurement.isEnabled).toBe(false);
    });

    it('an app made free voids its open invoices and switches paused plugins back on', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', status: 'PAUSED', currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
      const renewal = (await moduleInvoices().issueInvoice({
        tenantId: 't1', tenantSlug: 'acme', pluginKey: 'app:warehouse', kind: 'RENEWAL', anchor: new Date(), periodStart: null, periodEnd: null, dueAt: new Date(),
      })).invoice;
      Object.assign(billingDb.app.rows[0], { pricingModel: 'FREE', price: null });

      await subscriptions.applyPricingChange('app:warehouse');

      expect(billingDb.invoice.rows.find((i) => i.id === renewal.id)?.status).toBe('VOID');
      expect(subs['app:warehouse']).toMatchObject({ status: 'ACTIVE', pricingModel: 'FREE', currentPeriodEnd: null });
      expect(tenantPlugins.inventory.isEnabled).toBe(true);
      expect(tenantPlugins.procurement.isEnabled).toBe(true);
    });

    it('an app made paid gives free holders a trial', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', pricingModel: 'FREE', price: null, currentPeriodEnd: null, currency: 'IDR', grantedPlugins: ['inventory'] });
      const before = Date.now();

      await subscriptions.applyPricingChange('app:warehouse');

      expect(subs['app:warehouse']).toMatchObject({ status: 'TRIAL', pricingModel: 'MONTHLY', price: 200000, currency: 'IDR' });
      expect(subs['app:warehouse'].trialEndsAt.getTime()).toBeGreaterThanOrEqual(before + 14 * DAY_MS);
    });

    describe('a plugin removed from the app', () => {
      const renewalOf = async () => (await moduleInvoices().issueInvoice({
        tenantId: 't1', tenantSlug: 'acme', pluginKey: 'app:warehouse', kind: 'RENEWAL', anchor: new Date(), periodStart: null, periodEnd: null, dueAt: new Date(),
      })).invoice;

      beforeEach(() => {
        subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
        tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
        tenantPlugins.procurement = installedPlugin({ key: 'procurement' });
        // The sysadmin took procurement out of the app
        billingDb.appPlugin.rows.splice(1, 1);
      });

      it('the next paid invoice drops it and switches it off', async () => {
        const renewal = await renewalOf();

        await pay(renewal.id);

        expect(subs['app:warehouse'].grantedPlugins).toEqual(['inventory']);
        expect(tenantPlugins.procurement.isEnabled).toBe(false);
        expect(tenantPlugins.inventory.isEnabled).toBe(true);
      });

      it('stays on when the tenant also pays for it on its own', async () => {
        subs.procurement = sub({ pluginKey: 'procurement', currency: 'IDR' });
        const toggle = jest.spyOn(pluginsCore, 'toggleTenant');
        const renewal = await renewalOf();

        await pay(renewal.id);

        expect(subs['app:warehouse'].grantedPlugins).toEqual(['inventory']);
        expect(tenantPlugins.procurement.isEnabled).toBe(true);
        expect(toggle).not.toHaveBeenCalledWith('acme', 'procurement', false);
      });
    });

    it('subscription rows name the app and what it includes', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
      subs.inventory = sub({ pluginKey: 'inventory', currency: 'IDR', status: 'ENDED' });

      const rows = await subscriptions.tenantSubscriptions('acme', 't1');

      expect(rows.find((r) => r.pluginKey === 'app:warehouse')).toMatchObject({ kind: 'app', pluginName: 'Warehouse', includes: ['Inventory', 'Procurement'] });
      expect(rows.find((r) => r.pluginKey === 'inventory')).toMatchObject({ kind: 'plugin', pluginName: 'Inventory', includes: [] });
    });

    it('cancelling an own plugin subscription a live app grants leaves the plugin on', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', currency: 'IDR', grantedPlugins: ['inventory'] });
      subs.inventory = sub({ pluginKey: 'inventory', status: 'TRIAL', trialEndsAt: new Date(Date.now() + 5 * DAY_MS), currency: 'IDR' });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });

      await subscriptions.cancel('acme', 't1', 'inventory');

      expect(subs.inventory.status).toBe('ENDED');
      expect(tenantPlugins.inventory.isEnabled).toBe(true);
    });

    it('re-subscribing to an expired-trial app switches its previous grants off', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', status: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY_MS), currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      tenantPlugins.procurement = installedPlugin({ key: 'procurement' });

      const { subscription } = await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      expect(subscription.status).toBe('PENDING_PAYMENT');
      expect(tenantPlugins.inventory.isEnabled).toBe(false);
      expect(tenantPlugins.procurement.isEnabled).toBe(false);
    });

    it('credit counts only paid time of the current own subscription, not time credited before', async () => {
      subs.inventory = sub({ pluginKey: 'inventory', currency: 'IDR', startDate: d('2026-11-10'), currentPeriodStart: d('2026-11-10'), currentPeriodEnd: d('2026-12-10') });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      const paid = (id: string, start: string, end: string, subtotal: string) => ({
        id, number: `INV-2026-0${id.length}${id.charCodeAt(0)}`, dedupeKey: id, tenantId: 't1', tenantSlug: 'acme', pluginKey: 'inventory', pluginName: 'Inventory',
        kind: 'FIRST', pricingModel: 'MONTHLY', periodStart: d(start), periodEnd: d(end), currency: 'IDR', subtotal, total: subtotal, status: 'PAID', complimentary: false,
      });
      // A yearly purchase an earlier app already credited, then the current monthly subscription
      billingDb.invoice.rows.push(paid('old-yearly', '2026-11-01', '2027-11-01', '1800000'), paid('current', '2026-11-10', '2026-12-10', '150000'));
      const { invoiceId } = await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      await pay(invoiceId!, d('2026-11-25'));

      await expect(new CreditService(mockPrisma).balance('t1', 'IDR')).resolves.toBe('75000');
    });

    it('a plugin taken out of the app can be bought on its own before the renewal', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
      billingDb.appPlugin.rows.splice(1, 1); // procurement left the app

      await expect(subscriptions.subscribe('acme', 't1', 'procurement')).resolves.toMatchObject({ subscription: expect.objectContaining({ status: 'PENDING_PAYMENT' }) });
      await expect(subscriptions.subscribe('acme', 't1', 'inventory')).rejects.toThrow('"Inventory" is included in your Warehouse app.');
    });

    it('a hidden app can\'t be bought', async () => {
      billingDb.app.rows[0].isPublished = false;

      await expect(subscriptions.subscribe('acme', 't1', 'app:warehouse')).rejects.toThrow('"app:warehouse" is not available.');
    });

    it('Pay on a hidden app the tenant holds hands back its open invoice', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', status: 'PAUSED', currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
      const renewal = (await moduleInvoices().issueInvoice({
        tenantId: 't1', tenantSlug: 'acme', pluginKey: 'app:warehouse', kind: 'RENEWAL', anchor: new Date(), periodStart: null, periodEnd: null, dueAt: new Date(),
      })).invoice;
      billingDb.app.rows[0].isPublished = false;

      await expect(subscriptions.subscribe('acme', 't1', 'app:warehouse')).resolves.toMatchObject({ invoiceId: renewal.id });
    });

    it('an app made free keeps a removed plugin its live subscription still had', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      tenantPlugins.procurement = installedPlugin({ key: 'procurement' });
      billingDb.appPlugin.rows.splice(1, 1); // procurement left the app, paid for until the period end
      Object.assign(billingDb.app.rows[0], { pricingModel: 'FREE', price: null });

      await subscriptions.applyPricingChange('app:warehouse');

      expect(subs['app:warehouse']).toMatchObject({ status: 'ACTIVE', pricingModel: 'FREE' });
      expect(subs['app:warehouse'].grantedPlugins).toEqual(['inventory', 'procurement']);
      expect(tenantPlugins.procurement.isEnabled).toBe(true);
    });

    it('subscribing tells listeners the product name', async () => {
      await subscriptions.subscribe('acme', 't1', 'app:warehouse');

      expect(mockEvents.emit).toHaveBeenCalledWith(SystemEvents.PLUGIN_SUBSCRIBED, expect.objectContaining({ pluginKey: 'app:warehouse', pluginName: 'Warehouse' }));
    });

    it('an app row names the plugins that switch off when it ends', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', currency: 'IDR', grantedPlugins: ['inventory', 'procurement'] });
      // Inventory is also paid for on its own: it stays
      subs.inventory = sub({ pluginKey: 'inventory', currency: 'IDR' });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      tenantPlugins.procurement = installedPlugin({ key: 'procurement' });

      const rows = await subscriptions.tenantSubscriptions('acme', 't1');

      expect(rows.find((r) => r.pluginKey === 'app:warehouse')).toMatchObject({ includes: ['Inventory', 'Procurement'], switchesOff: ['Procurement'] });
      expect(rows.find((r) => r.pluginKey === 'inventory')).toMatchObject({ switchesOff: [] });
    });

    it('an app row counts the plugins that need a plugin switching off', async () => {
      subs['app:warehouse'] = sub({ pluginKey: 'app:warehouse', currency: 'IDR', grantedPlugins: ['inventory'] });
      // Procurement is paid for on its own but needs Inventory, which only the app grants
      subs.procurement = sub({ pluginKey: 'procurement', currency: 'IDR' });
      tenantPlugins.inventory = installedPlugin({ key: 'inventory' });
      tenantPlugins.procurement = installedPlugin({ key: 'procurement' });

      const rows = await subscriptions.tenantSubscriptions('acme', 't1');

      expect(rows.find((r) => r.pluginKey === 'app:warehouse')).toMatchObject({ switchesOff: ['Inventory', 'Procurement'] });
    });
  });
});
