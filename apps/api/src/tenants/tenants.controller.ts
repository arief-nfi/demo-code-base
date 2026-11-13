import { Controller, Get, Post, Body, UseGuards, Patch, Req, Res, UnauthorizedException, UseInterceptors, UploadedFile, Param, Delete } from '@nestjs/common';
import type { Response } from 'express';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard, RbacGuard, Roles, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { createTenantSchema, CreateTenantDto } from './dto/create-tenant.dto';
import { updateTenantConfigSchema, UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadService } from '../uploads/upload.service';

@ApiTags('Tenants')
@ApiBearerAuth()
@Controller('tenants')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly uploadService: UploadService,
  ) {}

  @Get('config')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get current tenant configuration' })
  getTenantConfig(@Req() req: AuthenticatedRequest) {
    const tenantId = req.headers['x-tenant-id'] as string;
    if (!tenantId) {
      throw new UnauthorizedException('Tenant ID not found in request');
    }
    return this.tenantsService.getTenantConfig(tenantId);
  }

  @Get(':id/config')
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Get configuration for a specific tenant' })
  getTenantConfigById(@Param('id') id: string) {
    return this.tenantsService.getTenantConfig(id);
  }

  @Patch(':id/config')
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Update configuration for a specific tenant' })
  updateTenantConfigById(@Param('id') id: string, @Body(new ZodValidationPipe(updateTenantConfigSchema)) updateDto: UpdateTenantConfigDto) {
    return this.tenantsService.updateTenantConfig(id, updateDto);
  }

  @Patch(':id/status')
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Update status for a specific tenant' })
  updateTenantStatus(@Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'INACTIVE' }) {
    return this.tenantsService.updateTenantStatus(id, body.status);
  }

  @Patch('config')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update current tenant configuration' })
  updateTenantConfig(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(updateTenantConfigSchema)) updateDto: UpdateTenantConfigDto) {
    const tenantId = req.headers['x-tenant-id'] as string;
    if (!tenantId) {
      throw new UnauthorizedException('Tenant ID not found in request');
    }
    return this.tenantsService.updateTenantConfig(tenantId, updateDto);
  }

  @Get()
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Get all tenants' })
  @ApiResponse({ status: 200, description: 'List of tenants' })
  findAll() {
    return this.tenantsService.findAll();
  }

  @Post()
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Create a new tenant' })
  @ApiResponse({ status: 201, description: 'The tenant has been successfully created.' })
  create(@Body(new ZodValidationPipe(createTenantSchema)) createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  @Delete(':id')
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Delete a tenant' })
  @ApiResponse({ status: 200, description: 'The tenant has been successfully deleted.' })
  delete(@Param('id') id: string) {
    return this.tenantsService.delete(id);
  }

  // --- Lifecycle Endpoints ---

  @Post(':id/suspend')
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Suspend a tenant' })
  suspend(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.tenantsService.suspendTenant(id, body.reason || 'manual');
  }

  @Post(':id/reactivate')
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Reactivate a suspended tenant' })
  reactivate(@Param('id') id: string) {
    return this.tenantsService.reactivateTenant(id);
  }

  @Post(':id/terminate')
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Terminate a tenant with grace period' })
  terminate(@Param('id') id: string, @Body() body: { graceDays?: number }) {
    return this.tenantsService.terminateTenant(id, body.graceDays);
  }

  @Get(':id/export')
  @Roles('SYSADMIN')
  @ApiOperation({ summary: 'Export all tenant data as JSON' })
  async exportData(@Param('id') id: string, @Res() res: Response) {
    const data = await this.tenantsService.exportTenantData(id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="tenant_${data.tenantSlug}_export.json"`);
    return res.send(JSON.stringify(data, null, 2));
  }

  @Patch('onboarding-complete')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Mark onboarding as complete for current tenant' })
  completeOnboarding(@Req() req: AuthenticatedRequest) {
    const tenantSlug = req.tenant?.slug;
    if (!tenantSlug) throw new UnauthorizedException('Tenant context required');
    return this.tenantsService.completeOnboarding(tenantSlug);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload tenant asset (logo/icon)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiQuery({ name: 'slug', required: false })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  @Roles('ADMIN', 'SYSADMIN')
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Req() req: AuthenticatedRequest) {
    const tenantSlug = (req.query.slug as string) || req.tenant?.slug;
    if (!tenantSlug) {
      throw new UnauthorizedException('Tenant slug is required');
    }
    const result = await this.uploadService.upload({
      file,
      category: 'config',
      tenantSlug,
      uploadedBy: (req.user as any)?.userId,
    });
    return { url: result.url, id: result.id };
  }
}
