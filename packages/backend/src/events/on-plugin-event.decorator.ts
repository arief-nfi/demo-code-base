import { OnEvent } from '@nestjs/event-emitter';
import type { PrismaService } from '../prisma/prisma.service';
import type { CacheService } from '../cache/cache.service';
import type { BaseEventPayload } from './system-events';

const PLUGIN_CACHE_TTL = 30_000; // 30 seconds

/**
 * Like @OnEvent but only fires if the specified plugin is enabled
 * for the tenant in the event payload.
 *
 * The decorated class must inject `prisma: PrismaService` and `cache: CacheService`
 * as instance properties for the tenant check to work.
 */
export function OnPluginEvent(
  event: string,
  pluginKey: string,
): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: { prisma?: PrismaService; cache?: CacheService }, ...args: unknown[]) {
      const payload = args[0] as BaseEventPayload | undefined;
      if (!payload?.tenantSlug) return;

      const { prisma, cache } = this;
      if (!prisma) return originalMethod.apply(this, args);

      // Check cache first
      const cacheKey = `plugin:tenant:${payload.tenantSlug}:${pluginKey}`;
      if (cache) {
        const cached = await cache.get<boolean>(cacheKey);
        if (cached !== null) {
          if (!cached) return; // Plugin disabled — skip silently
          return originalMethod.apply(this, args);
        }
      }

      // Cache miss — query tenant DB
      const tenantClient = prisma.getTenantClient(payload.tenantSlug);
      const tenantPlugin = await tenantClient.plugin.findUnique({
        where: { key: pluginKey },
      });

      const isEnabled = tenantPlugin?.isEnabled ?? false;
      if (cache) {
        await cache.set(cacheKey, isEnabled, PLUGIN_CACHE_TTL);
      }

      if (!isEnabled) return; // Plugin disabled — skip silently

      return originalMethod.apply(this, args);
    };

    // Apply the underlying @OnEvent decorator
    OnEvent(event)(target, propertyKey as string, descriptor);
    return descriptor;
  };
}
