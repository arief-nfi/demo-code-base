import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PluginsService } from './plugins.service';
import { JwtAuthGuard, RbacGuard, Roles, PluginMetricsService, ZodValidationPipe } from '@saas/backend';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { updatePricingSchema, UpdatePricingDto } from './dto/update-pricing.dto';

@ApiTags('Plugins')
@ApiBearerAuth()
@Controller('plugins')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('SYSADMIN')
export class PluginsController {
  constructor(
    private readonly pluginsService: PluginsService,
    private readonly metrics: PluginMetricsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all system plugins' })
  @ApiResponse({ status: 200, description: 'List of system plugins' })
  findAll(): Promise<Record<string, unknown>[]> {
    return this.pluginsService.findAllSystem() as Promise<Record<string, unknown>[]>;
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get plugin metrics' })
  @ApiResponse({ status: 200, description: 'Plugin metrics data' })
  @ApiQuery({ name: 'plugin', required: false, description: 'Filter by plugin key' })
  getMetrics(@Query('plugin') pluginKey?: string) {
    if (pluginKey) {
      return this.metrics.getForPlugin(pluginKey) ?? {};
    }
    return this.metrics.getAll();
  }

  @Post(':key/toggle')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Toggle a system plugin' })
  @ApiResponse({ status: 200, description: 'Plugin toggled' })
  @ApiBody({ schema: { type: 'object', properties: { isEnabled: { type: 'boolean' } } } })
  toggle(@Param('key') key: string, @Body('isEnabled') isEnabled: boolean): Promise<Record<string, unknown>> {
    return this.pluginsService.toggleSystem(key, isEnabled) as Promise<Record<string, unknown>>;
  }

  @Patch(':key/pricing')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Update plugin pricing' })
  @ApiResponse({ status: 200, description: 'Plugin pricing updated' })
  updatePricing(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(updatePricingSchema)) dto: UpdatePricingDto,
  ) {
    return this.pluginsService.updatePricing(key, dto);
  }
}
