import { Injectable, Logger } from '@nestjs/common';
import type { PluginLifecycle, PluginLifecycleContext, PluginHealthStatus } from './plugin-lifecycle.interface';

export interface EnabledPluginInfo {
  key: string;
  version: string | null;
  config: Record<string, unknown> | null;
}

@Injectable()
export class PluginHealthService {
  private readonly logger = new Logger(PluginHealthService.name);

  /**
   * Aggregate health checks for all enabled plugins in a tenant.
   */
  async checkAll(
    tenantSlug: string,
    lifecycles: Record<string, PluginLifecycle>,
    enabledPlugins: EnabledPluginInfo[],
  ): Promise<Record<string, PluginHealthStatus>> {
    const results: Record<string, PluginHealthStatus> = {};

    for (const plugin of enabledPlugins) {
      const lifecycle = lifecycles[plugin.key];

      if (!lifecycle?.healthCheck) {
        results[plugin.key] = {
          status: 'healthy',
          message: 'No health check defined',
          checkedAt: new Date(),
        };
        continue;
      }

      const context: PluginLifecycleContext = {
        tenantSlug,
        pluginKey: plugin.key,
        pluginVersion: plugin.version ?? '1.0.0',
        config: (plugin.config as Record<string, unknown>) ?? {},
      };

      try {
        results[plugin.key] = await this.executeWithTimeout(
          () => lifecycle.healthCheck!(context),
          10_000,
          `healthCheck for ${plugin.key}`,
        );
      } catch (error) {
        this.logger.warn(
          `Health check failed for plugin "${plugin.key}" on tenant "${tenantSlug}": ${error instanceof Error ? error.message : error}`,
        );
        results[plugin.key] = {
          status: 'unhealthy',
          message: error instanceof Error ? error.message : String(error),
          checkedAt: new Date(),
        };
      }
    }

    return results;
  }

  private executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Health check '${label}' timed out after ${timeoutMs}ms`)),
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
}
