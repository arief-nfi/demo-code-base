/**
 * Plugin SDK Contract v1
 *
 * All plugins should conform to this contract. The core platform uses
 * the `sdkVersion` field in the plugin manifest to determine compatibility.
 *
 * CHANGELOG:
 * - v1 (2024-01): Initial contract
 *   - PluginLifecycle interface (with context objects)
 *   - Permissions array format
 *   - Config schema (Zod)
 *   - Plugin manifest with dependencies & versioning
 */

export const CURRENT_SDK_VERSION = '1';

/**
 * Structured metadata declared in a plugin's package.json under "pluginManifest".
 */
export interface PluginManifest {
  /** Unique plugin key (matches directory name under plugins/) */
  key: string;

  /** Human-readable name */
  displayName: string;

  /** Short description */
  description?: string;

  /** Category for grouping (e.g. "security", "analytics", "general") */
  category?: string;

  /** Searchable tags */
  tags?: string[];

  /** Icon name (e.g. Lucide icon name) */
  icon?: string;

  /** Plugin SDK version this plugin was built against */
  sdkVersion: string;

  /** Core platform semver range requirement (e.g. ">=1.0.0") */
  coreCompatibility?: string;

  /** Other plugins this plugin depends on. Key = plugin key, value = semver range */
  pluginDependencies?: Record<string, string>;

  /** Plugin keys that conflict with this one (cannot both be enabled) */
  pluginConflicts?: string[];
}

/**
 * Extended plugin metadata used in the auto-generated registry.
 */
export interface PluginMetadata {
  key: string;
  name: string;
  description: string;
  version: string;
  authorName: string | null;
  authorEmail: string | null;
  authorUrl: string | null;
  dependencies: string[];
  conflicts: string[];
}
