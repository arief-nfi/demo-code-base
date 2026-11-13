import { SetMetadata } from '@nestjs/common';

export const PLUGIN_KEY_METADATA = 'plugin:key';

/**
 * Marks a controller as belonging to a specific plugin.
 * Used by PluginEnabledGuard to check tenant-level plugin access.
 *
 * @example
 * @PluginKey('sample-plugin')
 * @Controller('plugins/sample-plugin/items')
 * export class SampleItemsController {}
 */
export const PluginKey = (pluginKey: string) => SetMetadata(PLUGIN_KEY_METADATA, pluginKey);
