/**
 * Context object passed to plugin lifecycle hooks.
 */
export interface PluginLifecycleContext {
  tenantSlug: string;
  pluginKey: string;
  pluginVersion: string;
  config: Record<string, unknown>;
}

/**
 * Extended context for upgrade hooks — includes version transition info.
 */
export interface UpgradeContext extends PluginLifecycleContext {
  fromVersion: string;
  toVersion: string;
}

/**
 * Health status returned by a plugin's healthCheck hook.
 */
export interface PluginHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, unknown>;
  checkedAt: Date;
}

/**
 * Optional lifecycle hooks that plugins can implement.
 * These are called by the PluginsService when a plugin is enabled/disabled for a tenant.
 *
 * All hooks are optional — plugins implement only what they need.
 * Throwing from onInstall/onActivate/onDeactivate PREVENTS the toggle.
 * Throwing from onUpgrade triggers a rollback to the previous version.
 */
export interface PluginLifecycle {
  /**
   * Called on first-time installation for a tenant.
   * Use to seed initial data, create default config, set up resources.
   * Throwing here PREVENTS the plugin from being enabled.
   */
  onInstall?(context: PluginLifecycleContext): Promise<void>;

  /**
   * Called when re-enabling a previously installed plugin.
   * Lighter than onInstall — no need to re-seed data.
   * Throwing here PREVENTS the plugin from being enabled.
   */
  onActivate?(context: PluginLifecycleContext): Promise<void>;

  /**
   * Called when disabling a plugin for a tenant (its data stays; there is no uninstall).
   * Use for temporary teardown (pause cron jobs, etc.)
   * Throwing here PREVENTS the plugin from being disabled.
   */
  onDeactivate?(context: PluginLifecycleContext): Promise<void>;

  /**
   * Called when plugin version changes while enabling.
   * Use for data migrations. Throwing here triggers rollback.
   */
  onUpgrade?(context: UpgradeContext): Promise<void>;

  /**
   * Health check. Called by the health aggregation endpoint.
   * Should verify plugin dependencies (DB tables exist, config valid, etc.)
   */
  healthCheck?(context: PluginLifecycleContext): Promise<PluginHealthStatus>;

  /**
   * Return default configuration values for this plugin.
   * Applied when plugin is first installed for a tenant.
   */
  getDefaultConfig?(): Record<string, unknown>;
}

/** Injection token used to collect all lifecycle providers */
export const PLUGIN_LIFECYCLE = 'PLUGIN_LIFECYCLE';
