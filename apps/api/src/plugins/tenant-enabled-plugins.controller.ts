import { BadRequestException, Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { JwtAuthGuard } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * Read-only plugin availability for ANY authenticated user of the tenant (menus, route guards).
 * Deliberately separate from TenantPluginsController, whose class-level @Roles('ADMIN') would
 * otherwise apply. Registered before it in PluginsModule so `enabled` can't be shadowed by `:key`.
 */
@ApiTags('Tenant Plugins')
@ApiBearerAuth()
@Controller('tenant-plugins')
@UseGuards(JwtAuthGuard)
export class TenantEnabledPluginsController {
  constructor(private readonly pluginsService: PluginsService) {}

  @Get('enabled')
  @ApiOperation({ summary: 'List plugins enabled for the current tenant (keys only)' })
  @ApiResponse({
    status: 200,
    description: 'Plugins enabled system-wide and for this tenant',
    schema: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' } } } },
  })
  findEnabled(@Req() req: AuthenticatedRequest): Promise<Array<{ key: string }>> {
    if (!req.tenant?.slug) {
      throw new BadRequestException('Tenant context is required');
    }
    return this.pluginsService.findEnabledForTenant(req.tenant.slug);
  }
}
