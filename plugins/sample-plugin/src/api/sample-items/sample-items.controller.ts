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
import { createSampleItemSchema, CreateSampleItemDto } from './dto/create-sample-item.dto';
import type { SampleItemQueryDto } from './dto/sample-item-query.dto';
import { updateSampleItemSchema, UpdateSampleItemDto } from './dto/update-sample-item.dto';
import { SampleItemsService } from './sample-items.service';

@ApiTags('Sample Plugin - Items')
@ApiBearerAuth()
@Controller('plugins/sample-plugin/items')
@PluginKey('sample-plugin')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class SampleItemsController {
  constructor(private readonly sampleService: SampleItemsService) { }

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('sample-plugin.item.read')
  @ApiOperation({ summary: 'Get all sample items' })
  @ApiResponse({ status: 200, description: 'Return all sample items' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: SampleItemQueryDto) {
    return this.sampleService.findAll(this.getTenantSlug(req), query);
  }

  @Get('check-name')
  @Permissions('sample-plugin.item.read')
  @ApiOperation({ summary: 'Check if name is available' })
  @ApiResponse({ status: 200, description: 'Return availability status' })
  async checkName(
    @Req() req: AuthenticatedRequest,
    @Query('name') name: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const available = await this.sampleService.checkNameAvailable(name, excludeId, this.getTenantSlug(req));
    return { available };
  }

  @Get(':id')
  @Permissions('sample-plugin.item.read')
  @ApiOperation({ summary: 'Get a sample item by ID' })
  @ApiResponse({ status: 200, description: 'Return a sample item' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.sampleService.findOne(id, this.getTenantSlug(req));
  }

  @Post()
  @Permissions('sample-plugin.item.write')
  @ApiOperation({ summary: 'Create a new sample item' })
  @ApiResponse({ status: 201, description: 'Sample item created successfully' })
  create(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(createSampleItemSchema)) createDto: CreateSampleItemDto) {
    return this.sampleService.create(createDto, req.user.userId, this.getTenantSlug(req));
  }

  @Post('bulk-delete')
  @Permissions('sample-plugin.item.write')
  @ApiOperation({ summary: 'Delete multiple sample items' })
  @ApiResponse({
    status: 200,
    description: 'Sample items deleted successfully',
  })
  bulkDelete(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.sampleService.bulkDelete(body.ids, this.getTenantSlug(req)).then(() => ({ message: 'Sample items deleted successfully' }));
  }

  @Patch(':id')
  @Permissions('sample-plugin.item.write')
  @ApiOperation({ summary: 'Update a sample item' })
  @ApiResponse({ status: 200, description: 'Sample item updated successfully' })
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body(new ZodValidationPipe(updateSampleItemSchema)) updateDto: UpdateSampleItemDto) {
    return this.sampleService.update(id, updateDto, req.user.userId, this.getTenantSlug(req));
  }

  @Delete(':id')
  @Permissions('sample-plugin.item.write')
  @ApiOperation({ summary: 'Delete a sample item' })
  @ApiResponse({ status: 200, description: 'Sample item deleted successfully' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.sampleService.remove(id, this.getTenantSlug(req)).then(() => ({ message: 'Sample item deleted successfully' }));
  }
}
