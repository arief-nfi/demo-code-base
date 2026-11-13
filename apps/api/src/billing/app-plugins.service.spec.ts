import { SystemEvents } from '@saas/backend';
import { AppPluginsService } from './app-plugins.service';

const mockPluginManifests: Record<string, any> = {};
jest.mock('../plugin-registry', () => ({
  get PluginManifests() { return mockPluginManifests; },
}));

function setup(opts: {
  system: Record<string, string>; // key → pricingModel
  enabled: string[];
  subs?: Array<Record<string, unknown>>;
}) {
  const tenantPlugins: Record<string, { key: string; isEnabled: boolean }> = Object.fromEntries(
    Object.keys(opts.system).map((key) => [key, { key, isEnabled: opts.enabled.includes(key) }]),
  );
  const tenantClient = {
    plugin: {
      findMany: jest.fn(async () => Object.values(tenantPlugins).filter((p) => p.isEnabled).map((p) => ({ ...p }))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        Object.assign(tenantPlugins[where.key], data);
        return { count: 1 };
      }),
    },
    tenantSubscription: { findMany: jest.fn(async () => opts.subs ?? []) },
  };
  const prisma = {
    plugin: {
      findMany: jest.fn(async ({ where }: any) =>
        Object.entries(opts.system).filter(([key]) => where.key.in.includes(key)).map(([key, pricingModel]) => ({ key, pricingModel })),
      ),
    },
    getTenantClient: jest.fn(() => tenantClient),
  };
  const calls: Array<[string, boolean]> = [];
  const pluginsService = {
    toggleTenant: jest.fn(async (_slug: string, key: string, on: boolean) => {
      calls.push([key, on]);
      tenantPlugins[key].isEnabled = on;
      return tenantPlugins[key];
    }),
  };
  const cache = { del: jest.fn(async () => undefined) };
  const events = { emit: jest.fn() };
  const service = new AppPluginsService(prisma as any, cache as any, events as any, pluginsService as any);
  return { service, calls, pluginsService, cache, events, tenantPlugins };
}

const live = { status: 'ACTIVE', trialEndsAt: null };

describe('AppPluginsService', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockPluginManifests)) delete mockPluginManifests[key];
    mockPluginManifests.procurement = { pluginDependencies: { inventory: '^1' } };
    mockPluginManifests.reports = { pluginDependencies: { inventory: '^1' } };
  });

  it('switchOn goes dependencies first and skips plugins already on', async () => {
    const { service, calls } = setup({ system: { procurement: 'MONTHLY', inventory: 'MONTHLY', docs: 'FREE' }, enabled: ['docs'] });
    await expect(service.switchOn('acme', ['procurement', 'inventory', 'docs'])).resolves.toEqual([]);
    expect(calls).toEqual([['inventory', true], ['procurement', true]]);
  });

  it('switchOn returns failures instead of throwing', async () => {
    const { service, calls, pluginsService } = setup({ system: { procurement: 'MONTHLY', inventory: 'MONTHLY' }, enabled: [] });
    pluginsService.toggleTenant.mockImplementation(async (_s: string, key: string, on: boolean) => {
      if (key === 'procurement') throw new Error('boom');
      calls.push([key, on]);
      return { key, isEnabled: on };
    });
    await expect(service.switchOn('acme', ['inventory', 'procurement'])).resolves.toEqual([{ pluginKey: 'procurement', error: 'boom' }]);
    expect(calls).toEqual([['inventory', true]]);
  });

  it('switchOffUngranted leaves free, own-subscribed and other-app plugins on', async () => {
    const { service, calls } = setup({
      system: { inventory: 'MONTHLY', docs: 'FREE', owned: 'ONE_TIME', shared: 'MONTHLY' },
      enabled: ['inventory', 'docs', 'owned', 'shared'],
      subs: [
        { pluginKey: 'app:warehouse', status: 'PAUSED', trialEndsAt: null, grantedPlugins: ['inventory', 'docs', 'owned', 'shared'] },
        { pluginKey: 'owned', ...live },
        { pluginKey: 'app:retail', ...live, grantedPlugins: ['shared'] },
      ],
    });
    await expect(service.switchOffUngranted('acme', ['inventory', 'docs', 'owned', 'shared'])).resolves.toEqual(['inventory']);
    expect(calls).toEqual([['inventory', false]]);
  });

  it('switchOffUngranted switches dependents off first', async () => {
    const { service, calls } = setup({
      system: { inventory: 'MONTHLY', reports: 'MONTHLY' },
      enabled: ['inventory', 'reports'],
      subs: [
        { pluginKey: 'app:warehouse', status: 'ENDED', trialEndsAt: null, grantedPlugins: ['inventory'] },
        { pluginKey: 'reports', ...live },
      ],
    });
    await expect(service.switchOffUngranted('acme', ['inventory'])).resolves.toEqual(['reports', 'inventory']);
    expect(calls).toEqual([['reports', false], ['inventory', false]]);
  });

  it('switchOffUngranted forces a plugin off when the core refuses', async () => {
    const { service, pluginsService, events, tenantPlugins } = setup({
      system: { inventory: 'MONTHLY' },
      enabled: ['inventory'],
      subs: [{ pluginKey: 'app:warehouse', status: 'PAUSED', trialEndsAt: null, grantedPlugins: ['inventory'] }],
    });
    pluginsService.toggleTenant.mockRejectedValue(new Error('hook failed'));
    await expect(service.switchOffUngranted('acme', ['inventory'])).resolves.toEqual(['inventory']);
    expect(tenantPlugins.inventory.isEnabled).toBe(false);
    expect(events.emit).toHaveBeenCalledWith(SystemEvents.PLUGIN_DISABLED_TENANT, expect.objectContaining({ tenantSlug: 'acme', pluginKey: 'inventory' }));
  });

  it('switching clears the access cache of the plugins (Review Focus 1)', async () => {
    const { service, cache } = setup({
      system: { inventory: 'MONTHLY' },
      enabled: ['inventory'],
      subs: [{ pluginKey: 'app:warehouse', status: 'PAUSED', trialEndsAt: null, grantedPlugins: ['inventory'] }],
    });
    await service.switchOffUngranted('acme', ['inventory']);
    expect(cache.del).toHaveBeenCalledWith('plugin:tenant:acme:inventory');

    cache.del.mockClear();
    await service.clearAccessCache('acme', ['inventory', 'procurement']);
    expect(cache.del.mock.calls).toEqual([['plugin:tenant:acme:inventory'], ['plugin:tenant:acme:procurement']]);
  });
});
