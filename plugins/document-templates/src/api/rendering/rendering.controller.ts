import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, PluginEnabledGuard, PluginKey, RbacGuard, Permissions, Roles, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import type { Response } from 'express';
import { renderDocumentSchema, RenderDocumentDto } from '../templates/dto/render-document.dto';
import { RenderingService } from './rendering.service';
import { mergeFieldCategories } from './merge-fields';

@ApiTags('Document Templates - Rendering')
@ApiBearerAuth()
@Controller('plugins/document-templates')
@PluginKey('document-templates')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class RenderingController {
  constructor(private readonly renderingService: RenderingService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Post('render')
  @Permissions('document-templates.template.render')
  @ApiOperation({ summary: 'Render a document from a template' })
  @ApiResponse({ status: 200, description: 'Document rendered successfully' })
  async render(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Body(new ZodValidationPipe(renderDocumentSchema)) renderDto: RenderDocumentDto,
  ) {
    const tenantSlug = this.getTenantSlug(req);

    if (renderDto.format === 'html') {
      const { html } = await this.renderingService.renderHtml(
        tenantSlug,
        renderDto.templateSlug,
        renderDto.data,
      );
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    const { buffer, renderId } = await this.renderingService.renderPdf(
      tenantSlug,
      renderDto.templateSlug,
      renderDto.data,
      (req.user as any)?.userId,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${renderDto.templateSlug}-${renderId}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  }

  @Get('templates/:id/preview')
  @Permissions('document-templates.template.read')
  @ApiOperation({ summary: 'Preview a template with sample data' })
  @ApiResponse({ status: 200, description: 'Returns rendered HTML preview' })
  async preview(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Param('id') id: string,
  ) {
    const html = await this.renderingService.previewTemplate(
      this.getTenantSlug(req),
      id,
    );
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }

  @Get('merge-fields')
  @Permissions('document-templates.template.read')
  @ApiOperation({ summary: 'List all merge field categories' })
  @ApiResponse({ status: 200, description: 'Return merge field categories' })
  getMergeFieldCategories() {
    return Object.entries(mergeFieldCategories).map(([key, value]) => ({
      key,
      label: value.label,
      description: value.description,
      fieldCount: value.fields.length,
    }));
  }

  @Get('merge-fields/:category')
  @Permissions('document-templates.template.read')
  @ApiOperation({ summary: 'Get merge fields for a category' })
  @ApiResponse({ status: 200, description: 'Return merge fields' })
  getMergeFields(@Param('category') category: string) {
    const cat = mergeFieldCategories[category];
    if (!cat) {
      return { error: `Category '${category}' not found`, categories: Object.keys(mergeFieldCategories) };
    }
    return cat;
  }
}
