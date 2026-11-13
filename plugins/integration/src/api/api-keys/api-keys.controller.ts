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
import { createApiKeySchema } from './dto/create-api-key.dto';
import type { CreateApiKeyDto } from './dto/create-api-key.dto';
import { updateApiKeySchema } from './dto/update-api-key.dto';
import type { UpdateApiKeyDto } from './dto/update-api-key.dto';
import type { ApiKeyQueryDto } from './dto/api-key-query.dto';
import { ApiKeysService } from './api-keys.service';

@ApiTags('Integration - API Keys')
@ApiBearerAuth()
@Controller('plugins/integration/api-keys')
@PluginKey('integration')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('integration.api-key.read')
  @ApiOperation({ summary: 'Get all API keys' })
  @ApiResponse({ status: 200, description: 'Return all API keys (hash excluded)' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: ApiKeyQueryDto) {
    return this.apiKeysService.findAll(this.getTenantSlug(req), query);
  }

  @Get(':id')
  @Permissions('integration.api-key.read')
  @ApiOperation({ summary: 'Get an API key by ID' })
  @ApiResponse({ status: 200, description: 'Return an API key (hash excluded)' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.apiKeysService.findOne(id, this.getTenantSlug(req));
  }

  @Post()
  @Permissions('integration.api-key.write')
  @ApiOperation({ summary: 'Create a new API key' })
  @ApiResponse({ status: 201, description: 'API key created. Raw key returned once.' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createApiKeySchema)) dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(dto, this.getTenantSlug(req));
  }

  @Patch(':id')
  @Permissions('integration.api-key.write')
  @ApiOperation({ summary: 'Update an API key' })
  @ApiResponse({ status: 200, description: 'API key updated successfully' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateApiKeySchema)) dto: UpdateApiKeyDto,
  ) {
    return this.apiKeysService.update(id, dto, this.getTenantSlug(req));
  }

  @Delete(':id')
  @Permissions('integration.api-key.write')
  @ApiOperation({ summary: 'Delete an API key' })
  @ApiResponse({ status: 200, description: 'API key deleted successfully' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.apiKeysService.remove(id, this.getTenantSlug(req)).then(() => ({ message: 'API key deleted successfully' }));
  }

  @Post('bulk-delete')
  @Permissions('integration.api-key.write')
  @ApiOperation({ summary: 'Delete multiple API keys' })
  @ApiResponse({ status: 200, description: 'API keys deleted successfully' })
  bulkDelete(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.apiKeysService.bulkDelete(body.ids, this.getTenantSlug(req)).then(() => ({ message: 'API keys deleted successfully' }));
  }

  @Post(':id/revoke')
  @Permissions('integration.api-key.write')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: 200, description: 'API key revoked successfully' })
  revoke(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.apiKeysService.revoke(id, this.getTenantSlug(req));
  }

  @Post(':id/regenerate')
  @Permissions('integration.api-key.write')
  @ApiOperation({ summary: 'Regenerate an API key (revokes old, creates new)' })
  @ApiResponse({ status: 200, description: 'New API key generated. Raw key returned once.' })
  regenerate(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.apiKeysService.regenerate(id, this.getTenantSlug(req));
  }
}
