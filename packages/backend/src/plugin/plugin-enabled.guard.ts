import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { PLUGIN_KEY_METADATA } from './plugin-key.decorator';
import { PluginAccess } from './plugin-access';

@Injectable()
export class PluginEnabledGuard implements CanActivate {
  private readonly access: PluginAccess;

  constructor(
    private readonly reflector: Reflector,
    prisma: PrismaService,
    cache: CacheService,
  ) {
    this.access = new PluginAccess(prisma, cache);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const pluginKey = this.reflector.getAllAndOverride<string>(
      PLUGIN_KEY_METADATA,
      [context.getHandler(), context.getClass()],
    );

    // If no @PluginKey() decorator, skip check (non-plugin route)
    if (!pluginKey) return true;

    const request = context.switchToHttp().getRequest();
    const tenantSlug: string | undefined = request.tenant?.slug;

    if (!tenantSlug) {
      throw new ForbiddenException('Tenant context required for plugin routes');
    }

    // Switched on globally, for this tenant, and paid for if it isn't free
    const result = await this.access.check(pluginKey, tenantSlug);
    // `in` narrows even where strictNullChecks is off (plugin test configs compile this file too)
    if (!('reason' in result)) return true;

    switch (result.reason) {
      case 'not_found':
        throw new NotFoundException(`Plugin '${pluginKey}' not found`);
      case 'system_disabled':
        throw new ForbiddenException(`Plugin '${pluginKey}' is not available`);
      case 'no_subscription':
        throw new ForbiddenException(`Plugin '${pluginKey}' requires an active subscription`);
      default:
        throw new ForbiddenException(`Plugin '${pluginKey}' is not enabled for this tenant`);
    }
  }
}
