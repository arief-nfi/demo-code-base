import type { PrismaService } from '../prisma/prisma.service';
import type { CacheService } from '../cache/cache.service';
import { isPluginGranted } from './entitlement';

export type PluginAccessResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'system_disabled' | 'tenant_disabled' | 'no_subscription' };

interface SystemPluginState {
  isEnabled: boolean;
  pricingModel: string;
}

/**
 * "Can this tenant use this plugin right now?" — switched on globally, switched on
 * for the tenant, and (for a paid plugin) a live subscription of its own or a live app that grants it. PluginEnabledGuard
 * and anything else that needs the answer share this rule and its cache entries.
 * A plain class, not a provider, so a guard can build it from its own dependencies.
 */
export class PluginAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async check(pluginKey: string, tenantSlug: string): Promise<PluginAccessResult> {
    const system = await this.systemState(pluginKey);
    if (!system) return { ok: false, reason: 'not_found' };
    if (!system.isEnabled) return { ok: false, reason: 'system_disabled' };
    return this.tenantState(pluginKey, tenantSlug, system.pricingModel !== 'FREE');
  }

  private async systemState(pluginKey: string): Promise<SystemPluginState | null> {
    const cacheKey = `plugin:system:${pluginKey}`;
    const cached = await this.cache.get<SystemPluginState>(cacheKey);
    // Entries cached before pricing was part of this value were bare booleans: treat as a miss.
    if (cached !== null && typeof cached === 'object' && typeof cached.isEnabled === 'boolean') return cached;

    const plugin = await this.prisma.plugin.findUnique({ where: { key: pluginKey } });
    if (!plugin) return null;

    const state: SystemPluginState = { isEnabled: plugin.isEnabled, pricingModel: plugin.pricingModel };
    await this.cache.set(cacheKey, state, 60_000); // 1 min cache
    return state;
  }

  private async tenantState(pluginKey: string, tenantSlug: string, isPaid: boolean): Promise<PluginAccessResult> {
    const cacheKey = `plugin:tenant:${tenantSlug}:${pluginKey}`;
    const cached = await this.cache.get<boolean>(cacheKey);
    if (cached !== null) return cached ? { ok: true } : { ok: false, reason: 'tenant_disabled' };

    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const tenantPlugin = await tenantClient.plugin.findUnique({ where: { key: pluginKey } });
    if (!(tenantPlugin?.isEnabled ?? false)) {
      await this.cache.set(cacheKey, false, 30_000);
      return { ok: false, reason: 'tenant_disabled' };
    }

    // A paid plugin also needs a live source: its own subscription or an app that grants it.
    // Status transitions (trial end, pausing) belong to the billing job; this only reads.
    if (isPaid) {
      const subscriptions = await tenantClient.tenantSubscription.findMany();
      if (!isPluginGranted(pluginKey, subscriptions)) {
        await this.cache.set(cacheKey, false, 30_000);
        return { ok: false, reason: 'no_subscription' };
      }
    }

    await this.cache.set(cacheKey, true, 30_000); // 30s cache
    return { ok: true };
  }
}
