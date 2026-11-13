// plugins/sample-plugin/src/api/sample-articles/sample-articles.controller.ts
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
import {
  JwtAuthGuard,
  PluginEnabledGuard,
  PluginKey,
  RbacGuard,
  Permissions,
  Roles,
  ZodValidationPipe,
} from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { createSampleArticleSchema, CreateSampleArticleDto } from './dto/create-sample-article.dto';
import { updateSampleArticleSchema, UpdateSampleArticleDto } from './dto/update-sample-article.dto';
import type { SampleArticleQueryDto } from './dto/sample-article-query.dto';
import { SampleArticlesService } from './sample-articles.service';

@ApiTags('Sample Plugin - Articles')
@ApiBearerAuth()
@Controller('plugins/sample-plugin/articles')
@PluginKey('sample-plugin')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class SampleArticlesController {
  constructor(private readonly service: SampleArticlesService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('sample-plugin.article.read')
  @ApiOperation({ summary: 'Get all sample articles' })
  @ApiResponse({ status: 200, description: 'Return all sample articles' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: SampleArticleQueryDto) {
    return this.service.findAll(this.getTenantSlug(req), query);
  }

  @Get('check-slug')
  @Permissions('sample-plugin.article.read')
  @ApiOperation({ summary: 'Check if slug is available' })
  @ApiResponse({ status: 200, description: 'Return availability status' })
  async checkSlug(
    @Req() req: AuthenticatedRequest,
    @Query('slug') slug: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const available = await this.service.checkSlugAvailable(slug, excludeId, this.getTenantSlug(req));
    return { available };
  }

  @Get(':id')
  @Permissions('sample-plugin.article.read')
  @ApiOperation({ summary: 'Get a sample article by ID' })
  @ApiResponse({ status: 200, description: 'Return a sample article' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.findOne(id, this.getTenantSlug(req));
  }

  @Post()
  @Permissions('sample-plugin.article.write')
  @ApiOperation({ summary: 'Create a new sample article' })
  @ApiResponse({ status: 201, description: 'Sample article created successfully' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createSampleArticleSchema)) dto: CreateSampleArticleDto,
  ) {
    return this.service.create(dto, req.user.userId, this.getTenantSlug(req));
  }

  @Post('bulk-delete')
  @Permissions('sample-plugin.article.write')
  @ApiOperation({ summary: 'Delete multiple sample articles' })
  @ApiResponse({ status: 200, description: 'Sample articles deleted successfully' })
  bulkDelete(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.service
      .bulkDelete(body.ids, this.getTenantSlug(req))
      .then(() => ({ message: 'Sample articles deleted successfully' }));
  }

  @Patch(':id')
  @Permissions('sample-plugin.article.write')
  @ApiOperation({ summary: 'Update a sample article' })
  @ApiResponse({ status: 200, description: 'Sample article updated successfully' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSampleArticleSchema)) dto: UpdateSampleArticleDto,
  ) {
    return this.service.update(id, dto, req.user.userId, this.getTenantSlug(req));
  }

  @Delete(':id')
  @Permissions('sample-plugin.article.write')
  @ApiOperation({ summary: 'Delete a sample article' })
  @ApiResponse({ status: 200, description: 'Sample article deleted successfully' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service
      .remove(id, this.getTenantSlug(req))
      .then(() => ({ message: 'Sample article deleted successfully' }));
  }
}
