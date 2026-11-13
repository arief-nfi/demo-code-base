import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, PluginEnabledGuard, PluginKey, RbacGuard, Roles, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { sampleSettingSchema, SampleSettingDto } from './dto/sample-setting.dto';
import { SampleSettingsService } from './sample-settings.service';

@ApiTags('Sample Plugin - Settings')
@ApiBearerAuth()
@Controller('plugins/sample-plugin/settings')
@PluginKey('sample-plugin')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class SampleSettingsController {
  constructor(private readonly settingsService: SampleSettingsService) { }

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @ApiOperation({ summary: 'Get all sample settings' })
  @ApiResponse({ status: 200, description: 'Return all sample settings' })
  getAllSettings(@Req() req: AuthenticatedRequest) {
    return this.settingsService.getAllSettings(this.getTenantSlug(req));
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a sample setting by key' })
  @ApiResponse({ status: 200, description: 'Return a sample setting' })
  getSettingByKey(@Req() req: AuthenticatedRequest, @Param('key') key: string) {
    return this.settingsService.getSettingByKey(key, this.getTenantSlug(req));
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a sample setting' })
  @ApiResponse({ status: 201, description: 'Sample setting created or updated successfully' })
  upsertSetting(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(sampleSettingSchema)) setting: SampleSettingDto) {
    return this.settingsService.upsertSetting(setting, this.getTenantSlug(req));
  }
}
