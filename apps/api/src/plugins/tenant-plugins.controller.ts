import { Controller, Get, Post, Put, Body, Param, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PluginsService } from './plugins.service';
import { JwtAuthGuard, RbacGuard, Roles } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('Tenant Plugins')
@ApiBearerAuth()
@Controller('tenant-plugins')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('ADMIN')
export class TenantPluginsController {
  constructor(
    private readonly pluginsService: PluginsService,
  ) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @ApiOperation({ summary: 'Get all tenant plugins' })
  @ApiResponse({ status: 200, description: 'List of tenant plugins' })
  findAll(@Req() req: AuthenticatedRequest): Promise<Record<string, unknown>[]> {
    return this.pluginsService.findAllTenant(this.getTenantSlug(req)) as Promise<Record<string, unknown>[]>;
  }

  @Post(':key/toggle')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Toggle a tenant plugin' })
  @ApiResponse({ status: 200, description: 'Plugin toggled' })
  @ApiBody({ schema: { type: 'object', properties: { isEnabled: { type: 'boolean' } } } })
  toggle(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Body('isEnabled') isEnabled: boolean): Promise<Record<string, unknown>> {
    return this.pluginsService.toggleTenant(this.getTenantSlug(req), key, isEnabled) as Promise<Record<string, unknown>>;
  }

  @Get('health')
  @ApiOperation({ summary: 'Get health status of enabled plugins' })
  @ApiResponse({ status: 200, description: 'Plugin health status' })
  getHealth(@Req() req: AuthenticatedRequest) {
    return this.pluginsService.checkPluginHealth(this.getTenantSlug(req));
  }

  @Get(':key/config')
  @ApiOperation({ summary: 'Get plugin configuration for this tenant' })
  @ApiResponse({ status: 200, description: 'Plugin configuration' })
  getConfig(@Req() req: AuthenticatedRequest, @Param('key') key: string): Promise<{ key: string; config: unknown }> {
    return this.pluginsService.getPluginConfig(this.getTenantSlug(req), key);
  }

  @Put(':key/config')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Update plugin configuration for this tenant' })
  @ApiResponse({ status: 200, description: 'Plugin configuration updated' })
  async updateConfig(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Body() config: Record<string, unknown>): Promise<{ key: string; config: unknown }> {
    const result = await this.pluginsService.updatePluginConfig(this.getTenantSlug(req), key, config);
    return { key: result.key, config: result.config };
  }

}
