import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, PluginEnabledGuard, PluginKey, RbacGuard, Permissions, Roles } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { DefaultsService } from './defaults.service';

@ApiTags('Document Templates - Defaults')
@ApiBearerAuth()
@Controller('plugins/document-templates/defaults')
@PluginKey('document-templates')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class DefaultsController {
  constructor(private readonly defaultsService: DefaultsService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('document-templates.template.read')
  @ApiOperation({ summary: 'List available default templates' })
  @ApiResponse({ status: 200, description: 'Return list of default template definitions' })
  listDefaults() {
    return this.defaultsService.getDefaultTemplateList();
  }

  @Post('install')
  @Permissions('document-templates.template.create')
  @ApiOperation({ summary: 'Install all default templates' })
  @ApiResponse({ status: 201, description: 'Default templates installed' })
  installDefaults(@Req() req: AuthenticatedRequest) {
    return this.defaultsService.installDefaults(this.getTenantSlug(req), (req.user as any)?.userId);
  }

  @Post(':id/reset')
  @Permissions('document-templates.template.update')
  @ApiOperation({ summary: 'Reset a template to its default content' })
  @ApiResponse({ status: 200, description: 'Template reset to default' })
  resetToDefault(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.defaultsService.resetToDefault(id, this.getTenantSlug(req), (req.user as any)?.userId);
  }
}
