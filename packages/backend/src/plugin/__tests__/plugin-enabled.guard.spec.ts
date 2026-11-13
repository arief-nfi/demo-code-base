import { ForbiddenException } from '@nestjs/common';
import { PluginEnabledGuard } from '../plugin-enabled.guard';

const DAY = 24 * 60 * 60 * 1000;

function setup(opts: {
  pricingModel: string;
  tenantEnabled?: boolean;
  subscription?: { status: string; trialEndsAt: Date | null } | null;
}) {
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    del: jest.fn(async (key: string) => { store.delete(key); }),
  };
  const tenantClient = {
    plugin: {
      findUnique: jest.fn(async () => ({ key: 'sample-plugin', isEnabled: opts.tenantEnabled ?? true })),
      update: jest.fn(),
    },
    tenantSubscription: {
      findMany: jest.fn(async () => (opts.subscription ? [{ pluginKey: 'sample-plugin', ...opts.subscription }] : [])),
      update: jest.fn(),
    },
  };
  const prisma = {
    plugin: { findUnique: jest.fn(async () => ({ key: 'sample-plugin', isEnabled: true, pricingModel: opts.pricingModel })) },
    getTenantClient: jest.fn(() => tenantClient),
  };
  const reflector = { getAllAndOverride: jest.fn(() => 'sample-plugin') };
  const guard = new PluginEnabledGuard(reflector as any, prisma as any, cache as any);
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ tenant: { slug: 'acme' } }) }),
  } as any;
  return { guard, context, tenantClient, store };
}

describe('PluginEnabledGuard subscription rule', () => {
  it('allows a FREE plugin with no subscription row', async () => {
    const { guard, context } = setup({ pricingModel: 'FREE', subscription: null });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('blocks a paid plugin with no subscription row', async () => {
    const { guard, context } = setup({ pricingModel: 'MONTHLY', subscription: null });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows a paid plugin whose subscription is PAST_DUE', async () => {
    const { guard, context } = setup({ pricingModel: 'MONTHLY', subscription: { status: 'PAST_DUE', trialEndsAt: null } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('blocks an expired TRIAL without writing anything', async () => {
    const { guard, context, tenantClient } = setup({
      pricingModel: 'MONTHLY',
      subscription: { status: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY) },
    });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(tenantClient.tenantSubscription.update).not.toHaveBeenCalled();
    expect(tenantClient.plugin.update).not.toHaveBeenCalled();
  });

  it('treats a stale boolean system cache entry as a miss', async () => {
    const { guard, context, store } = setup({ pricingModel: 'MONTHLY', subscription: null });
    store.set('plugin:system:sample-plugin', true);
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
