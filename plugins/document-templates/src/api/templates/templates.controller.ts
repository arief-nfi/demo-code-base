import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, PluginEnabledGuard, PluginKey, RbacGuard, Permissions, Roles, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { createTemplateSchema, CreateTemplateDto } from './dto/create-template.dto';
import { updateTemplateSchema, UpdateTemplateDto } from './dto/update-template.dto';
import type { TemplateQueryDto } from './dto/template-query.dto';
import { TemplatesService } from './templates.service';

@ApiTags('Document Templates')
@ApiBearerAuth()
@Controller('plugins/document-templates/templates')
@PluginKey('document-templates')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('document-templates.template.read')
  @ApiOperation({ summary: 'List all document templates' })
  @ApiResponse({ status: 200, description: 'Return paginated list of templates' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: TemplateQueryDto) {
    return this.templatesService.findAll(this.getTenantSlug(req), query);
  }

  @Get(':id')
  @Permissions('document-templates.template.read')
  @ApiOperation({ summary: 'Get a document template by ID' })
  @ApiResponse({ status: 200, description: 'Return a document template' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.templatesService.findOne(id, this.getTenantSlug(req));
  }

  @Post()
  @Permissions('document-templates.template.create')
  @ApiOperation({ summary: 'Create a new document template' })
  @ApiResponse({ status: 201, description: 'Template created successfully' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createTemplateSchema)) createDto: CreateTemplateDto,
  ) {
    return this.templatesService.create(createDto, this.getTenantSlug(req), (req.user as any)?.userId);
  }

  @Patch(':id')
  @Permissions('document-templates.template.update')
  @ApiOperation({ summary: 'Update a document template' })
  @ApiResponse({ status: 200, description: 'Template updated successfully' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) updateDto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(id, updateDto, this.getTenantSlug(req), (req.user as any)?.userId);
  }

  @Delete(':id')
  @Permissions('document-templates.template.delete')
  @ApiOperation({ summary: 'Delete a document template' })
  @ApiResponse({ status: 200, description: 'Template deleted successfully' })
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.templatesService.remove(id, this.getTenantSlug(req));
    return { message: 'Template deleted successfully' };
  }

  @Post(':id/duplicate')
  @Permissions('document-templates.template.create')
  @ApiOperation({ summary: 'Duplicate a document template' })
  @ApiResponse({ status: 201, description: 'Template duplicated successfully' })
  duplicate(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.templatesService.duplicate(id, this.getTenantSlug(req), (req.user as any)?.userId);
  }
}
