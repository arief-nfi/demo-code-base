import { Injectable, OnModuleInit, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PrismaService,
  CacheService,
  PluginEventService,
  SystemEvents,
  PluginHealthService,
  PluginMetricsService,
  PluginLockService,
  pluginLogger,
  validatePluginConfig,
  redactSensitiveConfig,
  isPluginGranted,
  appKeyOf,
  appRef,
  grantingAppRefs,
} from '@saas/backend';
import type {
  PluginLifecycle,
  PluginLifecycleContext,
  UpgradeContext,
  PluginHealthStatus,
} from '@saas/backend';
import { PluginList, PluginLifecycles, PluginConfigSchemas, PluginManifests, PluginPermissions } from '../plugin-registry';
import type { Plugin } from '@saas/database';

@Injectable()
export class PluginsService implements OnModuleInit {
  private readonly logger = new Logger(PluginsService.name);
  private readonly pluginHealthService = new PluginHealthService();

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private pluginEventService: PluginEventService,
    private metrics: PluginMetricsService,
    private pluginLock: PluginLockService,
  ) {}

  async onModuleInit() {
    await this.syncPlugins();
  }

  async syncPlugins() {
    this.logger.log('Syncing plugins from registry...');
    for (const plugin of PluginList) {
      await this.prisma.plugin.upsert({
        where: { key: plugin.key },
        update: {
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          authorName: plugin.authorName,
          authorEmail: plugin.authorEmail,
          authorUrl: plugin.authorUrl,
        },
        create: {
          key: plugin.key,
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          authorName: plugin.authorName,
          authorEmail: plugin.authorEmail,
          authorUrl: plugin.authorUrl,
          isEnabled: false, // Default to disabled
        },
      });
    }
    // Enforce permission namespace: each permission must start with its plugin key
    for (const [pluginKey, permissions] of Object.entries(PluginPermissions)) {
      for (const perm of permissions) {
        if (!perm.name.startsWith(pluginKey + '.')) {
          this.logger.error(
            `SECURITY: Plugin "${pluginKey}" has permission "${perm.name}" that violates namespace convention (must start with "${pluginKey}.")`,
          );
        }
      }
    }

    this.logger.log(`Synced ${PluginList.length} plugins.`);
  }

  // --- Pricing ---

  async updatePricing(key: string, dto: { pricingModel: string; price?: number | null; pricingCurrency?: string; trialDays?: number; pricingLabel?: string | null }) {
    const plugin = await this.prisma.plugin.findUnique({ where: { key } });
    if (!plugin) {
      throw new BadRequestException(`Plugin "${key}" not found.`);
    }

    const data: Record<string, unknown> = {
      pricingModel: dto.pricingModel,
      pricingCurrency: dto.pricingCurrency ?? 'USD',
      trialDays: dto.pricingModel === 'FREE' ? 0 : (dto.trialDays ?? 0),
      pricingLabel: dto.pricingLabel ?? null,
      price: dto.pricingModel === 'FREE' ? null : (dto.price ?? null),
    };

    const result = await this.prisma.plugin.update({ where: { key }, data });
    await this.cache.del(`plugin:system:${key}`);
    this.pluginEventService.emit(SystemEvents.PLUGIN_PRICING_UPDATED, {
      tenantSlug: 'system',
      pluginKey: key,
      timestamp: new Date(),
    });
    return result;
  }

  // --- System Level (Public Schema) ---

  async findAllSystem() {
    return this.prisma.plugin.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async toggleSystem(key: string, isEnabled: boolean) {
    return this.pluginLock.withLock(`toggle:system:${key}`, async () => {
      const result = await this.prisma.plugin.upsert({
        where: { key },
        update: { isEnabled },
        create: {
          key,
          name: key,
          isEnabled,
        },
      });

      // Invalidate system-level cache so PluginEnabledGuard picks up the change
      await this.cache.del(`plugin:system:${key}`);

      this.pluginEventService.emit(
        isEnabled ? SystemEvents.PLUGIN_ENABLED_SYSTEM : SystemEvents.PLUGIN_DISABLED_SYSTEM,
        { tenantSlug: 'system', pluginKey: key, timestamp: new Date() },
      );

      return result;
    });
  }

  // --- Tenant Level (Tenant Schema) ---

  async findAllTenant(tenantSlug: string) {
    // 1. Get all globally enabled plugins from Public Schema
    const systemPlugins = await this.prisma.plugin.findMany({
      where: { isEnabled: true },
      orderBy: { name: 'asc' },
    });

    // 2. Get tenant's plugin configuration and subscriptions from Tenant Schema
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const [tenantPlugins, tenantSubscriptions] = await Promise.all([
      tenantClient.plugin.findMany(),
      tenantClient.tenantSubscription.findMany(),
    ]);
    const tenantPluginMap = new Map(tenantPlugins.map((p) => [p.key, p]));
    const subscriptionMap = new Map(tenantSubscriptions.map((s) => [s.pluginKey, s]));
    const [apps, appContents] = await Promise.all([
      this.prisma.app.findMany({ select: { id: true, key: true, name: true } }),
      this.prisma.appPlugin.findMany({ select: { appId: true, pluginKey: true } }),
    ]);
    const appNames = new Map(apps.map((a) => [appRef(a.key), a.name]));
    const appRefById = new Map(apps.map((a) => [a.id, appRef(a.key)]));
    // "<app ref> <plugin key>" for each plugin an app contains now
    const contains = new Set(appContents.map((c) => `${appRefById.get(c.appId)} ${c.pluginKey}`));

    // 3. Merge: Return system plugins with tenant state, pricing, and subscription
    return systemPlugins.map((sp) => {
      const sub = subscriptionMap.get(sp.key);
      return {
        ...sp,
        isEnabled: tenantPluginMap.get(sp.key)?.isEnabled ?? false,
        // Live apps that grant it: it isn't bought on its own while one does
        // (a plugin taken out of the app can be bought again before the renewal drops it)
        includedIn: grantingAppRefs(sp.key, tenantSubscriptions)
          .filter((ref) => contains.has(`${ref} ${sp.key}`))
          .map((ref) => ({ key: appKeyOf(ref)!, name: appNames.get(ref) ?? ref })),
        pricing: {
          pricingModel: sp.pricingModel,
          price: sp.price ? Number(sp.price) : null,
          pricingCurrency: sp.pricingCurrency,
          trialDays: sp.trialDays,
          pricingLabel: sp.pricingLabel,
        },
        subscription: sub ? {
          id: sub.id,
          status: sub.status,
          pricingModel: sub.pricingModel,
          price: sub.price ? Number(sub.price) : null,
          currency: sub.currency,
          startDate: sub.startDate,
          endDate: sub.endDate,
          trialEndsAt: sub.trialEndsAt,
          cancelledAt: sub.cancelledAt,
        } : null,
      };
    });
  }

  /**
   * Keys of plugins usable by this tenant (enabled system-wide AND for the tenant).
   * Read-only and non-sensitive: served to every authenticated tenant user for menus/route guards.
   */
  async findEnabledForTenant(tenantSlug: string): Promise<Array<{ key: string }>> {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const [systemPlugins, tenantPlugins] = await Promise.all([
      // Same ordering as findAllTenant, so the sidebar's plugin menu order is stable
      this.prisma.plugin.findMany({ where: { isEnabled: true }, select: { key: true }, orderBy: { name: 'asc' } }),
      tenantClient.plugin.findMany({ where: { isEnabled: true }, select: { key: true } }),
    ]);
    const tenantEnabled = new Set(tenantPlugins.map((p) => p.key));
    return systemPlugins.filter((p) => tenantEnabled.has(p.key)).map((p) => ({ key: p.key }));
  }

  async toggleTenant(tenantSlug: string, key: string, isEnabled: boolean): Promise<Plugin> {
    return this.pluginLock.withLock(`toggle:${tenantSlug}:${key}`, () =>
      this.toggleTenantUnlocked(tenantSlug, key, isEnabled),
    );
  }

  /**
   * Core tenant enable/disable: subscription + dependency checks, lifecycle hooks, default config,
   * permission provisioning, cache invalidation and events. Shared by toggleTenant and SubscriptionsService.
   * Does NOT take the lock — the caller must already hold `toggle:${tenantSlug}:${key}`
   * (PluginLockService is not re-entrant, so calling toggleTenant from inside that lock would deadlock).
   */
  async toggleTenantUnlocked(tenantSlug: string, key: string, isEnabled: boolean): Promise<Plugin> {
    // 1. Verify it's a valid system plugin and (when enabling) enabled globally.
    //    Disabling stays possible after a global disable (e.g. cancelling a subscription).
    const systemPlugin = await this.prisma.plugin.findUnique({
      where: { key },
    });

    if (!systemPlugin || (isEnabled && !systemPlugin.isEnabled)) {
      throw new BadRequestException('Plugin is not available in the system.');
    }

    // 2. Get current tenant plugin state
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const existingTenantPlugin = await tenantClient.plugin.findUnique({
      where: { key },
    });

    // 2a. Paid plugins can only be enabled with a live subscription (disabling is always allowed)
    if (isEnabled && systemPlugin.pricingModel !== 'FREE') {
      await this.assertActiveSubscription(key, tenantClient);
    }

    // 2b. Validate plugin dependencies / dependents
    if (isEnabled) {
      await this.validateDependencies(tenantSlug, key, tenantClient);
    } else {
      await this.validateNoDependents(tenantSlug, key, tenantClient);
    }

    const wasInstalled = existingTenantPlugin?.installedAt != null;
    const wasEnabled = existingTenantPlugin?.isEnabled ?? false;
    const lifecycle: PluginLifecycle | undefined = PluginLifecycles[key];

    // 3. Build lifecycle context
    let config = (existingTenantPlugin?.config as Record<string, unknown>) ?? {};
    const context: PluginLifecycleContext = {
      tenantSlug,
      pluginKey: key,
      pluginVersion: systemPlugin.version ?? '1.0.0',
      config,
    };

    // 4. Run lifecycle hooks BEFORE DB update — errors block the toggle
    const plog = pluginLogger(this.logger, key, tenantSlug);
    let hookName: string | undefined;
    let hookStart: number | undefined;

    try {
      if (isEnabled) {
        // Apply config defaults on first install
        if (!wasInstalled && lifecycle?.getDefaultConfig) {
          const defaults = lifecycle.getDefaultConfig();
          config = { ...defaults, ...config };
          context.config = config;
        }

        // Validate config size, depth, and key limits
        const configCheck = validatePluginConfig(config);
        if (!configCheck.valid) {
          throw new BadRequestException(configCheck.error);
        }

        // Validate config against schema on first install
        const schema = PluginConfigSchemas[key];
        if (schema && !wasInstalled) {
          const parseResult = schema.safeParse(config);
          if (!parseResult.success) {
            throw new BadRequestException({
              message: 'Invalid plugin configuration',
              errors: parseResult.error.flatten().fieldErrors,
            });
          }
          config = parseResult.data as Record<string, unknown>;
          context.config = config;
        }

        // Check for version upgrade
        const existingVersion = existingTenantPlugin?.version ?? '';
        const currentVersion = systemPlugin.version ?? '1.0.0';
        if (wasInstalled && wasEnabled && existingVersion && existingVersion !== currentVersion && lifecycle?.onUpgrade) {
          const upgradeContext: UpgradeContext = {
            ...context,
            fromVersion: existingVersion,
            toVersion: currentVersion,
          };
          hookName = 'lifecycle.onUpgrade';
          hookStart = Date.now();
          plog.log(`Calling onUpgrade (${existingVersion} → ${currentVersion})`);
          await this.executeWithTimeout(
            () => lifecycle.onUpgrade!(upgradeContext),
            60_000,
            `onUpgrade for ${key}`,
          );
          this.metrics.record(key, hookName, Date.now() - hookStart);
          plog.log(`onUpgrade completed in ${Date.now() - hookStart}ms`);
        } else if (!wasInstalled && lifecycle?.onInstall) {
          // First-time install
          hookName = 'lifecycle.onInstall';
          hookStart = Date.now();
          plog.log('Calling onInstall');
          await this.executeWithTimeout(
            () => lifecycle.onInstall!(context),
            30_000,
            `onInstall for ${key}`,
          );
          this.metrics.record(key, hookName, Date.now() - hookStart);
          plog.log(`onInstall completed in ${Date.now() - hookStart}ms`);
        } else if (wasInstalled && !wasEnabled && lifecycle?.onActivate) {
          // Re-enable previously installed plugin
          hookName = 'lifecycle.onActivate';
          hookStart = Date.now();
          plog.log('Calling onActivate');
          await this.executeWithTimeout(
            () => lifecycle.onActivate!(context),
            15_000,
            `onActivate for ${key}`,
          );
          this.metrics.record(key, hookName, Date.now() - hookStart);
          plog.log(`onActivate completed in ${Date.now() - hookStart}ms`);
        }
      } else {
        // Disabling
        if (wasEnabled && lifecycle?.onDeactivate) {
          hookName = 'lifecycle.onDeactivate';
          hookStart = Date.now();
          plog.log('Calling onDeactivate');
          await this.executeWithTimeout(
            () => lifecycle.onDeactivate!(context),
            15_000,
            `onDeactivate for ${key}`,
          );
          this.metrics.record(key, hookName, Date.now() - hookStart);
          plog.log(`onDeactivate completed in ${Date.now() - hookStart}ms`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (hookName && hookStart) {
        this.metrics.record(key, hookName, Date.now() - hookStart, error instanceof Error ? error : new Error(message));
      }
      plog.error(`Lifecycle hook failed: ${message}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to ${isEnabled ? 'enable' : 'disable'} plugin "${key}": ${message}`,
      );
    }

    // 5. Lifecycle succeeded — update DB
    const now = new Date();
    const result = await tenantClient.plugin.upsert({
      where: { key },
      update: {
        isEnabled,
        config: config as any,
        name: systemPlugin.name,
        description: systemPlugin.description,
        version: systemPlugin.version,
        authorName: systemPlugin.authorName,
        authorEmail: systemPlugin.authorEmail,
        authorUrl: systemPlugin.authorUrl,
        ...(isEnabled && !wasInstalled ? { installedAt: now } : {}),
        ...(isEnabled ? { activatedAt: now } : {}),
      },
      create: {
        key,
        name: systemPlugin.name,
        description: systemPlugin.description,
        version: systemPlugin.version,
        authorName: systemPlugin.authorName,
        authorEmail: systemPlugin.authorEmail,
        authorUrl: systemPlugin.authorUrl,
        isEnabled,
        config: config as any,
        installedAt: isEnabled ? now : null,
        activatedAt: isEnabled ? now : null,
      },
    });

    // 6. Seed plugin permissions into tenant DB and assign to ADMIN role
    //    (never USER: it starts empty and tenant admins grant permissions in the Roles screen)
    if (isEnabled) {
      const pluginPerms = PluginPermissions[key];
      if (pluginPerms && pluginPerms.length > 0) {
        for (const perm of pluginPerms) {
          await tenantClient.permission.upsert({
            where: { name: perm.name },
            update: { description: perm.description },
            create: { name: perm.name, description: perm.description },
          });
        }
        const adminRole = await tenantClient.role.findFirst({ where: { name: 'ADMIN' } });
        if (adminRole) {
          const permRecords = await tenantClient.permission.findMany({
            where: { name: { in: pluginPerms.map((p) => p.name) } },
          });
          await tenantClient.role.update({
            where: { id: adminRole.id },
            data: { permissions: { connect: permRecords.map((p) => ({ id: p.id })) } },
          });
        }
      }
    }

    // 7. Invalidate cache
    await this.cache.del(`plugin:tenant:${tenantSlug}:${key}`);

    // 8. Emit event
    this.pluginEventService.emit(
      isEnabled ? SystemEvents.PLUGIN_ENABLED_TENANT : SystemEvents.PLUGIN_DISABLED_TENANT,
      { tenantSlug, pluginKey: key, timestamp: now },
    );

    return result;
  }

  // --- Plugin Health Check ---

  async checkPluginHealth(tenantSlug: string): Promise<Record<string, PluginHealthStatus>> {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const enabledPlugins = await tenantClient.plugin.findMany({
      where: { isEnabled: true },
    });

    return this.pluginHealthService.checkAll(
      tenantSlug,
      PluginLifecycles,
      enabledPlugins.map((p) => ({
        key: p.key,
        version: p.version,
        config: p.config as Record<string, unknown> | null,
      })),
    );
  }

  // --- Plugin Configuration (Tenant Level) ---

  async getPluginConfig(tenantSlug: string, key: string) {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const plugin = await tenantClient.plugin.findUnique({ where: { key } });

    if (!plugin) {
      throw new BadRequestException(`Plugin "${key}" not found for this tenant.`);
    }

    return {
      key: plugin.key,
      config: plugin.config ?? {},
    };
  }

  async updatePluginConfig(tenantSlug: string, key: string, config: Record<string, unknown>) {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const plugin = await tenantClient.plugin.findUnique({ where: { key } });

    if (!plugin || !plugin.isEnabled) {
      throw new BadRequestException(`Plugin "${key}" is not enabled for this tenant.`);
    }

    // Keys the body doesn't send keep their value: a partial update must not reset settings
    // that other pages own (e.g. the Integration plugin's Google Calendar switch) to defaults
    const previousConfig = (plugin.config as Record<string, unknown>) ?? {};
    config = { ...previousConfig, ...config };

    // Validate config size, depth, and key limits
    const configCheck = validatePluginConfig(config);
    if (!configCheck.valid) {
      throw new BadRequestException(configCheck.error);
    }

    // Validate against plugin's config schema if one is registered
    const schema = PluginConfigSchemas[key];
    if (schema) {
      const result = schema.safeParse(config);
      if (!result.success) {
        throw new BadRequestException({
          message: 'Invalid plugin configuration',
          errors: result.error.flatten().fieldErrors,
        });
      }
      config = result.data as Record<string, unknown>;
    }

    const updated = await tenantClient.plugin.update({
      where: { key },
      data: { config: config as any },
    });

    // Redact sensitive fields before emitting to audit/event listeners
    this.pluginEventService.emit(SystemEvents.PLUGIN_CONFIG_UPDATED, {
      tenantSlug,
      pluginKey: key,
      previousConfig: redactSensitiveConfig(previousConfig),
      newConfig: redactSensitiveConfig(config),
      timestamp: new Date(),
    });

    return updated;
  }

  // --- Subscription Validation ---

  private async assertActiveSubscription(
    pluginKey: string,
    tenantClient: ReturnType<PrismaService['getTenantClient']>,
  ) {
    // Its own subscription, or a live app that grants it
    const subscriptions = await tenantClient.tenantSubscription.findMany();
    if (!isPluginGranted(pluginKey, subscriptions)) {
      throw new ForbiddenException(
        `Plugin "${pluginKey}" is a paid plugin and requires an active subscription. Subscribe to it to enable it.`,
      );
    }
  }

  // --- Dependency Validation ---

  private async validateDependencies(
    tenantSlug: string,
    pluginKey: string,
    tenantClient: ReturnType<PrismaService['getTenantClient']>,
  ) {
    const manifest = PluginManifests[pluginKey];
    if (!manifest?.pluginDependencies) return;

    const depKeys = Object.keys(manifest.pluginDependencies);
    if (depKeys.length === 0) return;

    const enabledPlugins = await tenantClient.plugin.findMany({
      where: { isEnabled: true },
    });
    const enabledSet = new Set(enabledPlugins.map((p) => p.key));

    const missing = depKeys.filter((dep) => !enabledSet.has(dep));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot enable plugin "${pluginKey}": required dependencies not enabled: ${missing.join(', ')}`,
      );
    }
  }

  private async validateNoDependents(
    tenantSlug: string,
    pluginKey: string,
    tenantClient: ReturnType<PrismaService['getTenantClient']>,
  ) {
    const enabledPlugins = await tenantClient.plugin.findMany({
      where: { isEnabled: true },
    });

    const dependents: string[] = [];
    for (const ep of enabledPlugins) {
      if (ep.key === pluginKey) continue;
      const manifest = PluginManifests[ep.key];
      if (manifest?.pluginDependencies && pluginKey in manifest.pluginDependencies) {
        dependents.push(ep.key);
      }
    }

    if (dependents.length > 0) {
      throw new BadRequestException(
        `Cannot disable plugin "${pluginKey}": other enabled plugins depend on it: ${dependents.join(', ')}`,
      );
    }
  }

  // --- Timeout Helper ---

  private executeWithTimeout<T = void>(
    fn: () => Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Lifecycle hook '${label}' timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // Deprecated: Alias for System
  async findAll() {
    return this.findAllSystem();
  }

  // Deprecated: Alias for System
  async toggle(key: string, isEnabled: boolean) {
    return this.toggleSystem(key, isEnabled);
  }
}
