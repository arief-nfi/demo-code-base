import { Injectable, Logger } from '@nestjs/common';
import { CacheService, PluginEventService, PrismaService, SystemEvents, isPluginGranted } from '@saas/backend';
import type { GrantSource } from '@saas/backend';
import { PluginsService } from '../plugins/plugins.service';
import { dependenciesFirst, dependentsOf, manifestDeps } from './dependency-order';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * What switching off `pluginKeys` switches off, in that order: the enabled plugins that need them,
 * then those of `pluginKeys` that are paid, on, and granted by nothing in `subs`. Free plugins stay on.
 */
export function switchOffOrder(pluginKeys: string[], subs: GrantSource[], paid: Set<string>, enabled: string[]): string[] {
  const ungranted = pluginKeys.filter((key) => paid.has(key) && enabled.includes(key) && !isPluginGranted(key, subs));
  if (!ungranted.length) return [];
  return [...dependentsOf(ungranted, enabled, manifestDeps), ...dependenciesFirst(ungranted, manifestDeps).reverse()];
}

/**
 * Switches the plugins an app grants on and off for a tenant, through the shared
 * toggle core (hooks, permissions, dependency checks). Callers may hold the app's
 * lock; each plugin is switched under its own lock (app → plugin order).
 */
@Injectable()
export class AppPluginsService {
  private readonly logger = new Logger(AppPluginsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly events: PluginEventService,
    private readonly pluginsService: PluginsService,
  ) {}

  /** Switch on, dependencies first, the plugins that aren't on yet. Never throws: failures are returned. */
  async switchOn(tenantSlug: string, pluginKeys: string[]): Promise<Array<{ pluginKey: string; error: string }>> {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const enabled = new Set((await tenantClient.plugin.findMany({ where: { isEnabled: true } })).map((p) => p.key));
    const failures: Array<{ pluginKey: string; error: string }> = [];
    for (const pluginKey of dependenciesFirst(pluginKeys, manifestDeps).filter((key) => !enabled.has(key))) {
      try {
        await this.pluginsService.toggleTenant(tenantSlug, pluginKey, true);
      } catch (error) {
        this.logger.warn(`"${pluginKey}" couldn't be switched on for ${tenantSlug}: ${message(error)}`);
        failures.push({ pluginKey, error: message(error) });
      }
    }
    await this.clearAccessCache(tenantSlug, pluginKeys);
    return failures;
  }

  /**
   * Switch off the paid plugins of `pluginKeys` that no live source grants any more
   * (read from the tenant's subscriptions now), and first the enabled plugins that
   * need them. Free plugins stay on. A plugin the core refuses to switch off is
   * forced off — whatever granted it has ended. Returns the keys switched off.
   */
  async switchOffUngranted(tenantSlug: string, pluginKeys: string[]): Promise<string[]> {
    if (!pluginKeys.length) return [];
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const [subs, system, enabledRows] = await Promise.all([
      tenantClient.tenantSubscription.findMany(),
      this.prisma.plugin.findMany({ where: { key: { in: pluginKeys } }, select: { key: true, pricingModel: true } }),
      tenantClient.plugin.findMany({ where: { isEnabled: true } }),
    ]);
    const paid = new Set(system.filter((p) => p.pricingModel !== 'FREE').map((p) => p.key));
    const order = switchOffOrder(pluginKeys, subs, paid, enabledRows.map((p) => p.key));
    if (!order.length) return [];

    for (const pluginKey of order) {
      try {
        await this.pluginsService.toggleTenant(tenantSlug, pluginKey, false);
      } catch (error) {
        this.logger.warn(`"${pluginKey}" for tenant ${tenantSlug}: clean disable failed (${message(error)}), forcing it off`);
        await tenantClient.plugin.updateMany({ where: { key: pluginKey }, data: { isEnabled: false } });
        this.events.emit(SystemEvents.PLUGIN_DISABLED_TENANT, { tenantSlug, pluginKey, timestamp: new Date() });
      }
    }
    await this.clearAccessCache(tenantSlug, order);
    return order;
  }

  /** Forget the cached "may this tenant use it" answer of each plugin. */
  async clearAccessCache(tenantSlug: string, pluginKeys: string[]): Promise<void> {
    for (const pluginKey of pluginKeys) {
      await this.cache.del(`plugin:tenant:${tenantSlug}:${pluginKey}`);
    }
  }
}
