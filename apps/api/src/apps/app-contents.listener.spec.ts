import { PluginLockService, SystemEvents } from '@saas/backend';
import { AppContentsListener } from './app-contents.listener';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function setup(subs: Record<string, Record<string, any>>, app: Record<string, any> = { key: 'warehouse', switchOnFailures: null }) {
  const tenantClient = (slug: string) => ({
    tenantSubscription: {
      findUnique: jest.fn(async ({ where }: any) => (subs[slug]?.[where.pluginKey] ? { ...subs[slug][where.pluginKey] } : null)),
      update: jest.fn(async ({ where, data }: any) => (subs[slug][where.pluginKey] = { ...subs[slug][where.pluginKey], ...data })),
    },
  });
  const prisma = {
    tenant: { findMany: jest.fn(async () => Object.keys(subs).map((slug) => ({ slug }))) },
    app: {
      findUnique: jest.fn(async () => ({ ...app })),
      update: jest.fn(async ({ data }: any) => Object.assign(app, data)),
    },
    plugin: {
      findMany: jest.fn(async () => [
        { key: 'inventory', name: 'Inventory' },
        { key: 'procurement', name: 'Procurement' },
        { key: 'reports', name: 'Reports' },
      ]),
    },
    getTenantClient: jest.fn((slug: string) => tenantClient(slug)),
  };
  const catalog = {
    getProduct: jest.fn(async () => ({ key: 'warehouse', ref: 'app:warehouse', kind: 'app', name: 'Warehouse', plugins: [{ key: 'inventory', name: 'Inventory' }, { key: 'procurement', name: 'Procurement' }] })),
  };
  const appPlugins = { switchOn: jest.fn(async () => []), clearAccessCache: jest.fn(async () => undefined) };
  const notifications = { notifyAdmins: jest.fn(async () => []) };
  const listener = new AppContentsListener(prisma as any, new PluginLockService(), catalog as any, appPlugins as any, notifications as any);
  return { listener, appPlugins, notifications, app, prisma };
}

const live = (over: Record<string, unknown> = {}) => ({
  pluginKey: 'app:warehouse', status: 'ACTIVE', pricingModel: 'MONTHLY', trialEndsAt: null, currentPeriodEnd: d('2026-12-01'), grantedPlugins: ['inventory'], ...over,
});
const event = (pluginKeys: string[]) => ({ tenantSlug: 'system', appKey: 'warehouse', pluginKeys, timestamp: new Date() });

describe('AppContentsListener', () => {
  it('adding a plugin grants it to live subscribers at once and switches it on', async () => {
    const subs = { acme: { 'app:warehouse': live() } };
    const { listener, appPlugins, notifications } = setup(subs);

    await listener.onAdded(event(['procurement']));

    expect(subs.acme['app:warehouse'].grantedPlugins).toEqual(['inventory', 'procurement']);
    expect(appPlugins.switchOn).toHaveBeenCalledWith('acme', ['procurement']);
    expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
      title: 'Warehouse got bigger', body: 'Warehouse now includes Procurement.', sourceEvent: SystemEvents.APP_PLUGINS_ADDED,
    }));
  });

  it('a plugin that can\'t be switched on is recorded on the app for the sysadmin and the tenant is told', async () => {
    const subs = { acme: { 'app:warehouse': live() }, beta: { 'app:warehouse': live() } };
    const { listener, appPlugins, notifications, app } = setup(subs);
    appPlugins.switchOn.mockImplementation((async (slug: string) => (slug === 'acme' ? [{ pluginKey: 'procurement', error: 'hook failed' }] : [])) as any);
    jest.spyOn((listener as any).logger, 'warn').mockImplementation(() => undefined);

    await listener.onAdded(event(['procurement']));

    expect(app.switchOnFailures).toEqual([{ tenantSlug: 'acme', pluginKey: 'procurement', error: 'hook failed', at: expect.any(String) }]);
    expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
      body: 'Warehouse now includes Procurement. Procurement couldn\'t be switched on: turn it on in Tenant Plugins.',
    }));
    expect(notifications.notifyAdmins).toHaveBeenCalledWith('beta', expect.objectContaining({ body: 'Warehouse now includes Procurement.' }));
  });

  it('adding a plugin again replaces what was recorded for it and keeps other failures', async () => {
    const subs = { acme: { 'app:warehouse': live() } };
    const { listener, prisma, app } = setup(subs, {
      key: 'warehouse',
      switchOnFailures: [
        { tenantSlug: 'acme', pluginKey: 'procurement', error: 'old', at: '2026-10-01T00:00:00.000Z' },
        { tenantSlug: 'acme', pluginKey: 'reports', error: 'hook failed', at: '2026-10-01T00:00:00.000Z' },
      ],
    });

    await listener.onAdded(event(['procurement']));

    expect(app.switchOnFailures).toEqual([{ tenantSlug: 'acme', pluginKey: 'reports', error: 'hook failed', at: '2026-10-01T00:00:00.000Z' }]);
    expect(prisma.app.update).toHaveBeenCalledTimes(1);
  });

  it('nothing to record: the app isn\'t written', async () => {
    const { listener, prisma } = setup({ acme: { 'app:warehouse': live() } });
    await listener.onAdded(event(['procurement']));
    expect(prisma.app.update).not.toHaveBeenCalled();
  });

  it('a paused subscriber gets the added plugin only when it pays again', async () => {
    const subs = { acme: { 'app:warehouse': live({ status: 'PAUSED' }) } };
    const { listener, appPlugins, notifications } = setup(subs);

    await listener.onAdded(event(['procurement']));

    expect(subs.acme['app:warehouse'].grantedPlugins).toEqual(['inventory']);
    expect(appPlugins.switchOn).not.toHaveBeenCalled();
    expect(notifications.notifyAdmins).not.toHaveBeenCalled();
  });

  it('removing a plugin warns recurring subscribers and changes nothing yet', async () => {
    const subs = {
      acme: { 'app:warehouse': live({ grantedPlugins: ['inventory', 'procurement'] }) },
      owner: { 'app:warehouse': live({ pricingModel: 'ONE_TIME', currentPeriodEnd: null, grantedPlugins: ['inventory', 'procurement'] }) },
    };
    const { listener, appPlugins, notifications } = setup(subs);

    await listener.onRemoved(event(['procurement']));

    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
      title: 'Change to Warehouse',
      body: 'Procurement will leave Warehouse at your next renewal on 1 Dec 2026. Buy it on its own to keep using it.',
      sourceEvent: SystemEvents.APP_PLUGINS_REMOVED,
    }));
    expect(subs.acme['app:warehouse'].grantedPlugins).toEqual(['inventory', 'procurement']);
    expect(appPlugins.switchOn).not.toHaveBeenCalled();
  });

  it('removing several plugins speaks of them', async () => {
    const subs = { acme: { 'app:warehouse': live({ grantedPlugins: ['inventory', 'procurement', 'reports'] }) } };
    const { listener, notifications } = setup(subs);

    await listener.onRemoved(event(['procurement', 'reports']));

    expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
      body: 'Procurement, Reports will leave Warehouse at your next renewal on 1 Dec 2026. Buy them on their own to keep using them.',
    }));
  });

  it('never throws', async () => {
    const subs = { acme: { 'app:warehouse': live() } };
    const { listener, appPlugins } = setup(subs);
    appPlugins.switchOn.mockRejectedValue(new Error('boom'));
    jest.spyOn((listener as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(listener.onAdded(event(['procurement']))).resolves.toBeUndefined();
  });
});
