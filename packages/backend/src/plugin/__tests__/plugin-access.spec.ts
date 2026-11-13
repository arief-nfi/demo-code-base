import { PluginAccess } from '../plugin-access';

const DAY = 24 * 60 * 60 * 1000;

function setup(opts: {
  plugin?: { isEnabled: boolean; pricingModel: string } | null;
  tenantEnabled?: boolean;
  subscription?: { status: string; trialEndsAt: Date | null } | null;
  /** Other subscriptions of the tenant (e.g. apps), served together with `subscription`. */
  subscriptions?: Array<{ pluginKey: string; status: string; trialEndsAt: Date | null; grantedPlugins?: string[] }>;
}) {
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  };
  const tenantClient = {
    plugin: { findUnique: jest.fn(async () => (opts.tenantEnabled === undefined ? null : { key: 'docs', isEnabled: opts.tenantEnabled })) },
    tenantSubscription: {
      findMany: jest.fn(async () => [
        ...(opts.subscription ? [{ pluginKey: 'docs', ...opts.subscription }] : []),
        ...(opts.subscriptions ?? []),
      ]),
    },
  };
  const prisma = {
    plugin: { findUnique: jest.fn(async () => (opts.plugin === undefined ? { key: 'docs', isEnabled: true, pricingModel: 'FREE' } : opts.plugin)) },
    getTenantClient: jest.fn(() => tenantClient),
  };
  return { access: new PluginAccess(prisma as any, cache as any), prisma, tenantClient, store };
}

describe('PluginAccess.check', () => {
  it('ok for a free plugin enabled for the tenant', async () => {
    const { access } = setup({ tenantEnabled: true });
    await expect(access.check('docs', 'acme')).resolves.toEqual({ ok: true });
  });

  it('tenant_disabled when the tenant row is off or missing', async () => {
    await expect(setup({ tenantEnabled: false }).access.check('docs', 'acme')).resolves.toEqual({ ok: false, reason: 'tenant_disabled' });
    await expect(setup({}).access.check('docs', 'acme')).resolves.toEqual({ ok: false, reason: 'tenant_disabled' });
  });

  it('no_subscription for a paid plugin without a live subscription', async () => {
    const paid = { isEnabled: true, pricingModel: 'MONTHLY' };
    await expect(setup({ plugin: paid, tenantEnabled: true, subscription: null }).access.check('docs', 'acme'))
      .resolves.toEqual({ ok: false, reason: 'no_subscription' });
    await expect(setup({ plugin: paid, tenantEnabled: true, subscription: { status: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY) } }).access.check('docs', 'acme'))
      .resolves.toEqual({ ok: false, reason: 'no_subscription' });
    await expect(setup({ plugin: paid, tenantEnabled: true, subscription: { status: 'ACTIVE', trialEndsAt: null } }).access.check('docs', 'acme'))
      .resolves.toEqual({ ok: true });
  });

  it('ok for a paid plugin with no own subscription when a live app grants it', async () => {
    const { access } = setup({
      plugin: { isEnabled: true, pricingModel: 'MONTHLY' },
      tenantEnabled: true,
      subscriptions: [{ pluginKey: 'app:warehouse', status: 'ACTIVE', trialEndsAt: null, grantedPlugins: ['docs'] }],
    });
    await expect(access.check('docs', 'acme')).resolves.toEqual({ ok: true });
  });

  it('no_subscription when the only app granting it is paused', async () => {
    const { access } = setup({
      plugin: { isEnabled: true, pricingModel: 'MONTHLY' },
      tenantEnabled: true,
      subscriptions: [{ pluginKey: 'app:warehouse', status: 'PAUSED', trialEndsAt: null, grantedPlugins: ['docs'] }],
    });
    await expect(access.check('docs', 'acme')).resolves.toEqual({ ok: false, reason: 'no_subscription' });
  });

  it('system_disabled when switched off globally', async () => {
    const { access, tenantClient } = setup({ plugin: { isEnabled: false, pricingModel: 'FREE' }, tenantEnabled: true });
    await expect(access.check('docs', 'acme')).resolves.toEqual({ ok: false, reason: 'system_disabled' });
    expect(tenantClient.plugin.findUnique).not.toHaveBeenCalled();
  });

  it('not_found for an unknown plugin', async () => {
    await expect(setup({ plugin: null }).access.check('docs', 'acme')).resolves.toEqual({ ok: false, reason: 'not_found' });
  });

  it('uses the cache on a second call (same keys and TTLs as the guard)', async () => {
    const { access, prisma, tenantClient, store } = setup({ tenantEnabled: true });

    await access.check('docs', 'acme');
    await access.check('docs', 'acme');

    expect(prisma.plugin.findUnique).toHaveBeenCalledTimes(1);
    expect(tenantClient.plugin.findUnique).toHaveBeenCalledTimes(1);
    expect(store.get('plugin:system:docs')).toEqual({ isEnabled: true, pricingModel: 'FREE' });
    expect(store.get('plugin:tenant:acme:docs')).toBe(true);
  });
});
