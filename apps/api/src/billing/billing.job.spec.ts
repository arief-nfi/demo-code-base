import { PluginLockService, SystemEvents } from '@saas/backend';
import { BillingJob } from './billing.job';
import { InvoiceService } from './invoice.service';
import { CatalogService } from './catalog.service';
import { CreditService } from './credit.service';
import { AppPluginsService } from './app-plugins.service';
import { SubscriptionsService } from './subscriptions.service';
import { createBillingDb, matches, type BillingDb } from './testing/in-memory-billing-db';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** One tenant schema: subscriptions + tenant plugin rows. */
function tenantSchema() {
  const subs: Record<string, any> = {};
  const plugins: Record<string, any> = {};
  return {
    subs,
    plugins,
    client: {
      tenantSubscription: {
        findMany: jest.fn(async ({ where }: any = {}) => Object.values(subs).filter((s) => matches(s, where)).map((s) => ({ ...s }))),
        findUnique: jest.fn(async ({ where }: any) => (subs[where.pluginKey] ? { ...subs[where.pluginKey] } : null)),
        update: jest.fn(async ({ where, data }: any) => (subs[where.pluginKey] = { ...subs[where.pluginKey], ...data })),
        upsert: jest.fn(async ({ where, update, create }: any) =>
          (subs[where.pluginKey] = subs[where.pluginKey] ? { ...subs[where.pluginKey], ...update } : { ...create })),
      },
      plugin: {
        findUnique: jest.fn(async ({ where }: any) => plugins[where.key] ?? null),
        findMany: jest.fn(async ({ where }: any = {}) => Object.values(plugins).filter((p) => matches(p, where))),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!plugins[where.key]) return { count: 0 };
          Object.assign(plugins[where.key], data);
          return { count: 1 };
        }),
      },
    },
  };
}

function setup() {
  const db: BillingDb = createBillingDb();
  db.plugin.rows.push({ key: 'docs', name: 'Document Templates', isEnabled: true, pricingModel: 'MONTHLY', price: '150000.00', pricingCurrency: 'IDR', trialDays: 0 });
  const schemas: Record<string, ReturnType<typeof tenantSchema>> = {};
  const addTenant = (id: string, slug: string, status = 'ACTIVE') => {
    db.tenant.rows.push({ id, slug, name: slug, status });
    schemas[slug] = tenantSchema();
    return schemas[slug];
  };
  const prisma: any = {
    get plugin() { return db.plugin; },
    get tenant() { return db.tenant; },
    get invoice() { return db.invoice; },
    get invoiceCounter() { return db.invoiceCounter; },
    get paymentCheckout() { return db.paymentCheckout; },
    get app() { return db.app; },
    get appPlugin() { return db.appPlugin; },
    get billingCredit() { return db.billingCredit; },
    $executeRaw: async () => 0,
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    getTenantClient: jest.fn((slug: string) => {
      if (!schemas[slug]) throw new Error(`schema tenant_${slug} does not exist`);
      return schemas[slug].client;
    }),
  };
  const settings = {
    getSettings: jest.fn(async () => ({ taxEnabled: false, taxName: 'PPN', taxRate: 11, renewalLeadDays: 7, graceDays: 7, checkoutValidHours: 24 })),
    getProfile: jest.fn(async () => ({ companyName: null, billingEmail: null, address: null, taxId: null })),
  };
  const events = { emit: jest.fn() };
  const cache = { del: jest.fn(async () => undefined) };
  const lock = new PluginLockService();
  // The shared toggle core, reduced to what billing relies on: flip the tenant plugin's flag
  const flip = async (slug: string, key: string, on: boolean) => {
    schemas[slug].plugins[key] = { ...(schemas[slug].plugins[key] ?? { key }), isEnabled: on };
  };
  const pluginsService = {
    toggleTenantUnlocked: jest.fn(flip),
    toggleTenant: jest.fn(flip),
  };
  const catalog = new CatalogService(prisma);
  const credits = new CreditService(prisma);
  const invoices = new InvoiceService(prisma, settings as any, catalog, credits);
  const appPlugins = new AppPluginsService(prisma, cache as any, events as any, pluginsService as any);
  const subscriptions = new SubscriptionsService(prisma, cache as any, events as any, lock, pluginsService as any, invoices, settings as any, null, credits, catalog, appPlugins);
  const checkout = { expireStale: jest.fn(async () => 0) };
  const job = new BillingJob(prisma, lock, subscriptions, invoices, checkout as any, settings as any, events as any, cache as any, catalog);
  return { db, schemas, addTenant, job, subscriptions, events, checkout, pluginsService, cache };
}

const activeSub = (over: Record<string, unknown> = {}) => ({
  pluginKey: 'docs', status: 'ACTIVE', pricingModel: 'MONTHLY', price: 150000, currency: 'IDR',
  startDate: d('2026-09-20'), endDate: d('2026-10-20'), trialEndsAt: null,
  currentPeriodStart: d('2026-09-20'), currentPeriodEnd: d('2026-10-20'),
  cancelAtPeriodEnd: false, pastDueAt: null, pausedAt: null, endedAt: null, createdAt: d('2026-09-20'),
  ...over,
});

describe('BillingJob', () => {
  it('issues a renewal 7 days before period end exactly once across repeated runs', async () => {
    const { db, addTenant, job, events } = setup();
    addTenant('t1', 'acme').subs.docs = activeSub();

    await job.run(d('2026-10-14'));
    await job.run(new Date(d('2026-10-14').getTime() + 3600_000));

    expect(db.invoice.rows).toHaveLength(1);
    expect(db.invoice.rows[0]).toMatchObject({ kind: 'RENEWAL', tenantId: 't1', periodStart: d('2026-10-20'), dueAt: d('2026-10-20') });
    expect(events.emit.mock.calls.filter(([e]) => e === SystemEvents.BILLING_INVOICE_ISSUED)).toHaveLength(1);
  });

  it('a renewal invoice for a month-end plan shows the anchored period (Feb 28 → Mar 31)', async () => {
    const { db, addTenant, job } = setup();
    addTenant('t1', 'acme').subs.docs = activeSub({ currentPeriodStart: d('2026-01-31'), currentPeriodEnd: d('2026-02-28') });

    await job.run(d('2026-02-21'));

    expect(db.invoice.rows[0]).toMatchObject({ kind: 'RENEWAL', periodStart: d('2026-02-28'), periodEnd: d('2026-03-31') });
  });

  it('past due at the period end, paused after the grace period, plugin switched off', async () => {
    const { addTenant, job, events } = setup();
    const acme = addTenant('t1', 'acme');
    acme.subs.docs = activeSub();
    acme.plugins.docs = { key: 'docs', isEnabled: true };

    await job.run(d('2026-10-14'));
    await job.run(d('2026-10-20'));
    expect(acme.subs.docs).toMatchObject({ status: 'PAST_DUE', pastDueAt: d('2026-10-20') });
    expect(acme.plugins.docs.isEnabled).toBe(true);

    await job.run(d('2026-10-27'));
    expect(acme.subs.docs).toMatchObject({ status: 'PAUSED', pausedAt: d('2026-10-27') });
    expect(acme.plugins.docs.isEnabled).toBe(false);
    expect(events.emit).toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_PAST_DUE, expect.objectContaining({ tenantSlug: 'acme', pluginKey: 'docs' }));
    expect(events.emit).toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_PAUSED, expect.objectContaining({ tenantSlug: 'acme', pluginKey: 'docs' }));
  });

  it('a scheduled cancel ends the subscription at the period end without a renewal', async () => {
    const { db, addTenant, job } = setup();
    const acme = addTenant('t1', 'acme');
    acme.subs.docs = activeSub({ cancelAtPeriodEnd: true });
    acme.plugins.docs = { key: 'docs', isEnabled: true };

    await job.run(d('2026-10-15'));
    await job.run(d('2026-10-20'));

    expect(db.invoice.rows).toHaveLength(0);
    expect(acme.subs.docs).toMatchObject({ status: 'ENDED', endedAt: d('2026-10-20') });
    expect(acme.plugins.docs.isEnabled).toBe(false);
  });

  it('cancel inside the renewal window: the renewal already sent is voided when the plan ends', async () => {
    const { db, addTenant, job } = setup();
    const acme = addTenant('t1', 'acme');
    acme.subs.docs = activeSub();
    acme.plugins.docs = { key: 'docs', isEnabled: true };
    await job.run(d('2026-10-14'));
    expect(db.invoice.rows[0]).toMatchObject({ kind: 'RENEWAL', status: 'OPEN' });

    acme.subs.docs.cancelAtPeriodEnd = true; // the tenant cancels after receiving the renewal invoice
    await job.run(d('2026-10-20'));

    expect(acme.subs.docs.status).toBe('ENDED');
    expect(db.invoice.rows[0].status).toBe('VOID');
  });

  it('skips SUSPENDED tenants and catches up with a single invoice after reactivation', async () => {
    const { db, addTenant, job } = setup();
    addTenant('t1', 'acme', 'SUSPENDED').subs.docs = activeSub();

    await job.run(d('2026-10-25'));
    expect(db.invoice.rows).toHaveLength(0);

    db.tenant.rows[0].status = 'ACTIVE';
    await job.run(d('2026-12-01'));
    await job.run(new Date(d('2026-12-01').getTime() + 3600_000));

    expect(db.invoice.rows).toHaveLength(1);
    expect(db.invoice.rows[0]).toMatchObject({ kind: 'RENEWAL', periodStart: d('2026-10-20') });
  });

  it('a caught-up subscription gets a fresh grace period from the catch-up run', async () => {
    const { addTenant, job, db } = setup();
    const acme = addTenant('t1', 'acme', 'SUSPENDED');
    acme.subs.docs = activeSub();
    db.tenant.rows[0].status = 'ACTIVE';

    await job.run(d('2026-12-01'));
    expect(acme.subs.docs).toMatchObject({ status: 'PAST_DUE', pastDueAt: d('2026-12-01') });
    await job.run(d('2026-12-07'));
    expect(acme.subs.docs.status).toBe('PAST_DUE');
    await job.run(d('2026-12-08'));
    expect(acme.subs.docs.status).toBe('PAUSED');
  });

  it('a tenant reactivated while a plan was past due gets a fresh grace period', async () => {
    const { db, addTenant, job, subscriptions } = setup();
    const acme = addTenant('t1', 'acme', 'SUSPENDED');
    acme.subs.docs = activeSub({ status: 'PAST_DUE', pastDueAt: d('2026-10-20') });
    acme.plugins.docs = { key: 'docs', isEnabled: true };

    db.tenant.rows[0].status = 'ACTIVE';
    await subscriptions.restartGraceAfterReactivation('acme', d('2026-12-01'));
    await job.run(d('2026-12-01'));
    expect(acme.subs.docs).toMatchObject({ status: 'PAST_DUE', pastDueAt: d('2026-12-01') });

    await job.run(d('2026-12-08'));
    expect(acme.subs.docs.status).toBe('PAUSED');
  });

  it('pause then payment ends ACTIVE', async () => {
    const { db, addTenant, job, subscriptions } = setup();
    const acme = addTenant('t1', 'acme');
    acme.subs.docs = activeSub();
    acme.plugins.docs = { key: 'docs', isEnabled: true };
    await job.run(d('2026-10-14'));
    await job.run(d('2026-10-20'));
    await job.run(d('2026-10-27'));
    expect(acme.subs.docs.status).toBe('PAUSED');

    await subscriptions.activateFromPayment(db.invoice.rows[0].id, { paidAt: d('2026-10-28'), provider: 'fake', complimentary: false });

    expect(acme.subs.docs).toMatchObject({ status: 'ACTIVE', currentPeriodStart: d('2026-10-28'), currentPeriodEnd: d('2026-11-28') });
    expect(acme.plugins.docs.isEnabled).toBe(true);
  });

  it('payment that lands before the pausing run: the job never pauses (strict order)', async () => {
    const { db, addTenant, job, subscriptions, events } = setup();
    const acme = addTenant('t1', 'acme');
    acme.subs.docs = activeSub();
    acme.plugins.docs = { key: 'docs', isEnabled: true };
    await job.run(d('2026-10-14'));
    await job.run(d('2026-10-20'));
    expect(acme.subs.docs.status).toBe('PAST_DUE');

    await subscriptions.activateFromPayment(db.invoice.rows[0].id, { paidAt: d('2026-10-26'), provider: 'fake', complimentary: false });
    await job.run(d('2026-10-27'));

    expect(events.emit).not.toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_PAUSED, expect.anything());
    expect(acme.subs.docs).toMatchObject({ status: 'ACTIVE', currentPeriodStart: d('2026-10-20') });
    expect(acme.plugins.docs.isEnabled).toBe(true);
  });

  it('payment and the pausing run racing: whichever goes first, it ends ACTIVE', async () => {
    const { db, addTenant, job, subscriptions } = setup();
    const acme = addTenant('t1', 'acme');
    acme.subs.docs = activeSub();
    acme.plugins.docs = { key: 'docs', isEnabled: true };
    await job.run(d('2026-10-14'));
    await job.run(d('2026-10-20'));

    // Payment and the pausing run race; both take the same toggle lock
    await Promise.all([
      subscriptions.activateFromPayment(db.invoice.rows[0].id, { paidAt: d('2026-10-26'), provider: 'fake', complimentary: false }),
      job.run(d('2026-10-27')),
    ]);

    expect(acme.subs.docs.status).toBe('ACTIVE');
    expect(acme.plugins.docs.isEnabled).toBe(true);
    await job.run(d('2026-10-28'));
    expect(acme.subs.docs.status).toBe('ACTIVE');
  });

  it('a tenant that throws is reported in errors and the next tenant is still processed', async () => {
    const { db, addTenant, job } = setup();
    db.tenant.rows.push({ id: 't0', slug: 'broken', name: 'broken', status: 'ACTIVE' }); // no schema → getTenantClient throws
    addTenant('t1', 'acme').subs.docs = activeSub();

    const result = await job.run(d('2026-10-14'));

    expect(result.errors).toEqual([expect.objectContaining({ tenantSlug: 'broken', error: expect.stringContaining('does not exist') })]);
    expect(db.invoice.rows).toHaveLength(1);
    expect(result.tenants).toBe(2);
  });

  it('a subscription whose switch-off fails is still paused (plugin forced off) and others continue', async () => {
    const { addTenant, job, pluginsService } = setup();
    const acme = addTenant('t1', 'acme');
    acme.subs.docs = activeSub({ status: 'PAST_DUE', pastDueAt: d('2026-10-20') });
    acme.plugins.docs = { key: 'docs', isEnabled: true };
    pluginsService.toggleTenantUnlocked.mockRejectedValueOnce(new Error('onDeactivate hook failed'));

    await job.run(d('2026-10-27'));

    expect(acme.subs.docs.status).toBe('PAUSED');
    expect(acme.plugins.docs.isEnabled).toBe(false);
  });

  it('migrates a PENDING_APPROVAL subscription and issues its first invoice once', async () => {
    const { db, addTenant, job } = setup();
    addTenant('t1', 'acme').subs.docs = activeSub({ status: 'PENDING_APPROVAL', currentPeriodStart: null, currentPeriodEnd: null, endDate: null });

    await job.run(d('2026-10-21'));
    await job.run(d('2026-10-21'));

    expect(db.invoice.rows).toHaveLength(1);
    expect(db.invoice.rows[0]).toMatchObject({ kind: 'FIRST', status: 'OPEN' });
  });

  it('expires stale checkouts at the end of a run', async () => {
    const { job, checkout } = setup();
    await job.run(d('2026-10-21'));
    expect(checkout.expireStale).toHaveBeenCalledWith(d('2026-10-21'));
  });

  it('does not run twice concurrently', async () => {
    const { addTenant, job } = setup();
    addTenant('t1', 'acme').subs.docs = activeSub();

    const [first, second] = await Promise.all([job.run(d('2026-10-14')), job.run(d('2026-10-14'))]);

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
  });

  it('gives tenants already using a now-paid plugin a 14-day trial (existing data, no subscription row)', async () => {
    const { addTenant, job } = setup();
    const acme = addTenant('t1', 'acme');
    acme.plugins.docs = { key: 'docs', isEnabled: true };

    await job.run(d('2026-10-21'));

    expect(acme.subs.docs).toMatchObject({ status: 'TRIAL', trialEndsAt: d('2026-11-04') });
  });

  it('runs once when the API starts, without blocking startup or throwing', async () => {
    const { job } = setup();
    const run = jest.spyOn(job, 'run').mockRejectedValueOnce(new Error('db not ready'));
    jest.spyOn((job as any).logger, 'error').mockImplementation(() => undefined);

    expect(job.onApplicationBootstrap()).toBeUndefined();
    await new Promise((r) => setImmediate(r));

    expect(run).toHaveBeenCalledTimes(1);
  });

  describe('apps', () => {
    const appSub = (key: string, over: Record<string, unknown> = {}) => activeSub({ pluginKey: `app:${key}`, price: 200000, ...over });

    function appSetup() {
      const ctx = setup();
      ctx.db.plugin.rows.push(
        { key: 'inventory', name: 'Inventory', isEnabled: true, pricingModel: 'MONTHLY', price: '150000.00', pricingCurrency: 'IDR', trialDays: 0 },
        { key: 'owned', name: 'Owned', isEnabled: true, pricingModel: 'ONE_TIME', price: '900000.00', pricingCurrency: 'IDR', trialDays: 0 },
        { key: 'templ', name: 'Templates', isEnabled: true, pricingModel: 'FREE', price: null, pricingCurrency: 'IDR', trialDays: 0 },
      );
      ctx.db.app.rows.push(
        { id: 'app-1', key: 'warehouse', name: 'Warehouse', isPublished: true, pricingModel: 'MONTHLY', price: '200000.00', pricingCurrency: 'IDR', trialDays: 0 },
        { id: 'app-2', key: 'retail', name: 'Retail', isPublished: true, pricingModel: 'MONTHLY', price: '120000.00', pricingCurrency: 'IDR', trialDays: 0 },
      );
      ctx.db.appPlugin.rows.push(
        { appId: 'app-1', pluginKey: 'inventory', position: 0 },
        { appId: 'app-1', pluginKey: 'owned', position: 1 },
        { appId: 'app-1', pluginKey: 'templ', position: 2 },
        { appId: 'app-2', pluginKey: 'inventory', position: 0 },
      );
      const acme = ctx.addTenant('t1', 'acme');
      for (const key of ['inventory', 'owned', 'templ']) acme.plugins[key] = { key, isEnabled: true };
      return { ...ctx, acme };
    }

    it('a past-due app pauses and switches off only plugins nothing else grants', async () => {
      const { acme, job, events, pluginsService } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', { status: 'PAST_DUE', pastDueAt: d('2026-10-20'), grantedPlugins: ['inventory', 'owned', 'templ'] });
      acme.subs.owned = activeSub({ pluginKey: 'owned', pricingModel: 'ONE_TIME', currentPeriodEnd: null });

      await job.run(d('2026-10-28'));

      expect(acme.subs['app:warehouse']).toMatchObject({ status: 'PAUSED' });
      expect(pluginsService.toggleTenant.mock.calls).toEqual([['acme', 'inventory', false]]);
      expect(acme.plugins.owned.isEnabled).toBe(true);
      expect(acme.plugins.templ.isEnabled).toBe(true);
      expect(acme.subs.inventory).toBeUndefined();
      expect(events.emit).toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_PAUSED, expect.objectContaining({ tenantSlug: 'acme', pluginKey: 'app:warehouse' }));
    });

    it('pausing one app leaves a plugin another live app grants on (Review Focus 4)', async () => {
      const { acme, job, pluginsService } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', { status: 'PAST_DUE', pastDueAt: d('2026-10-20'), grantedPlugins: ['inventory'] });
      acme.subs['app:retail'] = appSub('retail', { currentPeriodEnd: d('2026-11-20'), grantedPlugins: ['inventory'] });

      await job.run(d('2026-10-28'));

      expect(acme.subs['app:warehouse'].status).toBe('PAUSED');
      expect(acme.plugins.inventory.isEnabled).toBe(true);
      expect(pluginsService.toggleTenant).not.toHaveBeenCalled();
    });

    it('pausing an app clears the access cache of its plugins (Review Focus 1)', async () => {
      const { acme, job, cache } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', { status: 'PAST_DUE', pastDueAt: d('2026-10-20'), grantedPlugins: ['inventory', 'templ'] });

      await job.run(d('2026-10-28'));

      expect(cache.del).toHaveBeenCalledWith('plugin:tenant:acme:inventory');
      expect(cache.del).toHaveBeenCalledWith('plugin:tenant:acme:templ');
    });

    it('a cancelled app ends at period end and switches its plugins off', async () => {
      const { acme, job } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', { cancelAtPeriodEnd: true, grantedPlugins: ['inventory'] });

      await job.run(d('2026-10-20'));

      expect(acme.subs['app:warehouse']).toMatchObject({ status: 'ENDED' });
      expect(acme.plugins.inventory.isEnabled).toBe(false);
    });

    it('app renewal invoices use the app price', async () => {
      const { db, acme, job } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', { grantedPlugins: ['inventory'] });

      await job.run(d('2026-10-14'));

      expect(db.invoice.rows).toEqual([expect.objectContaining({ kind: 'RENEWAL', pluginKey: 'app:warehouse', pluginName: 'Warehouse', subtotal: '200000' })]);
    });

    it('an own subscription that stops renewing ends while a live app grants it: the plugin stays on', async () => {
      const { acme, job, pluginsService } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', { currentPeriodEnd: d('2026-12-20'), grantedPlugins: ['inventory'] });
      acme.subs.inventory = activeSub({ pluginKey: 'inventory', currency: 'USD', cancelAtPeriodEnd: true });

      await job.run(d('2026-10-20'));

      expect(acme.subs.inventory.status).toBe('ENDED');
      expect(acme.plugins.inventory.isEnabled).toBe(true);
      expect(pluginsService.toggleTenant).not.toHaveBeenCalled();
      expect(pluginsService.toggleTenantUnlocked).not.toHaveBeenCalled();
    });

    it('an app trial that ends unpaid gives its plugins no trials of their own and switches them off', async () => {
      const { acme, job } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', {
        status: 'TRIAL', trialEndsAt: d('2026-10-20'), currentPeriodStart: null, currentPeriodEnd: null, grantedPlugins: ['inventory'],
      });

      await job.run(d('2026-10-21'));

      expect(acme.subs.inventory).toBeUndefined();
      expect(acme.subs['app:warehouse'].status).toBe('PAUSED');
      expect(acme.plugins.inventory.isEnabled).toBe(false);
    });

    it('the job settles a fully credited invoice that was left open', async () => {
      const { db, acme, job } = appSetup();
      acme.subs.docs = activeSub();
      db.invoice.rows.push({
        id: 'inv-credited', number: 'INV-2026-0999', dedupeKey: 'credited', tenantId: 't1', tenantSlug: 'acme', pluginKey: 'docs',
        pluginName: 'Document Templates', kind: 'RENEWAL', pricingModel: 'MONTHLY', periodStart: d('2026-10-20'), periodEnd: d('2026-11-20'),
        currency: 'IDR', subtotal: '150000', creditAmount: '150000', taxAmount: '0', total: '0', status: 'OPEN', dueAt: d('2026-10-20'),
      });

      await job.run(d('2026-10-01'));

      expect(db.invoice.rows.find((i) => i.id === 'inv-credited')).toMatchObject({ status: 'PAID', paymentProvider: 'credit' });
    });

    it('a renewal fully covered by credit is never marked past due, even when issued after the period end', async () => {
      const { db, acme, job, events } = appSetup();
      acme.subs.docs = activeSub();
      db.billingCredit.rows.push({ id: 'c1', tenantId: 't1', currency: 'IDR', kind: 'GRANT', amount: '150000', reason: 'Unused time', sourceKey: 'inventory' });

      await job.run(d('2026-10-21'));

      expect(events.emit).not.toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_PAST_DUE, expect.anything());
      expect(db.invoice.rows).toEqual([expect.objectContaining({ kind: 'RENEWAL', total: '0', status: 'PAID', paymentProvider: 'credit' })]);
      expect(acme.subs.docs).toMatchObject({ status: 'ACTIVE', currentPeriodStart: d('2026-10-20'), currentPeriodEnd: d('2026-11-20') });
    });

    it('a trial whose conversion is fully covered by credit is not paused', async () => {
      const { db, acme, job, events } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', {
        status: 'TRIAL', trialEndsAt: d('2026-10-20'), currentPeriodStart: null, currentPeriodEnd: null, grantedPlugins: ['inventory'],
      });
      db.billingCredit.rows.push({ id: 'c1', tenantId: 't1', currency: 'IDR', kind: 'GRANT', amount: '200000', reason: 'Unused time', sourceKey: 'inventory' });

      await job.run(d('2026-10-21'));

      expect(events.emit).not.toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_PAUSED, expect.anything());
      expect(acme.subs['app:warehouse'].status).toBe('ACTIVE');
      expect(acme.plugins.inventory.isEnabled).toBe(true);
    });

    it('a paused app tells which plugins were switched off', async () => {
      const { acme, job, events } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', { status: 'PAST_DUE', pastDueAt: d('2026-10-20'), grantedPlugins: ['inventory', 'owned', 'templ'] });
      acme.subs.owned = activeSub({ pluginKey: 'owned', pricingModel: 'ONE_TIME', currentPeriodEnd: null });

      await job.run(d('2026-10-28'));

      expect(events.emit).toHaveBeenCalledWith(SystemEvents.BILLING_SUBSCRIPTION_PAUSED, expect.objectContaining({ pluginKey: 'app:warehouse', switchedOff: ['inventory'] }));
    });

    it('free → paid trials skip plugins an app grants', async () => {
      const { acme, job } = appSetup();
      acme.subs['app:warehouse'] = appSub('warehouse', { currentPeriodEnd: d('2026-12-20'), grantedPlugins: ['inventory'] });

      await job.run(d('2026-10-28'));

      expect(acme.subs.inventory).toBeUndefined();
    });
  });
});
