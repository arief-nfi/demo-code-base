import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, Res } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PermissionQueryDto } from './dto/permission-query.dto';
import { JwtAuthGuard, RbacGuard, Roles, Permissions } from '@saas/backend';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '@saas/backend';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('Permissions')
@ApiBearerAuth()
@Controller('system/permissions')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('ADMIN')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Post()
  @Permissions('system.permission.write')
  @ApiOperation({ summary: 'Create a new permission' })
  @ApiResponse({ status: 201, description: 'The permission has been successfully created.' })
  create(@Req() req: AuthenticatedRequest, @Body() createPermissionDto: CreatePermissionDto) {
    return this.permissionsService.create(this.getTenantSlug(req), createPermissionDto);
  }

  @Get('check-name')
  @Permissions('system.permission.read')
  @ApiOperation({ summary: 'Check if permission name is available' })
  @ApiResponse({ status: 200, description: 'Returns availability status' })
  checkName(@Req() req: AuthenticatedRequest, @Query('name') name: string, @Query('excludeId') excludeId?: string) {
    return this.permissionsService.checkNameAvailability(this.getTenantSlug(req), name, excludeId);
  }

  @Get('export')
  @Permissions('system.permission.read')
  @ApiOperation({ summary: 'Export permissions to CSV' })
  @ApiResponse({ status: 200, description: 'CSV file' })
  async export(@Req() req: AuthenticatedRequest, @Query() query: PermissionQueryDto, @Res() res: Response) {
    const csv = await this.permissionsService.export(this.getTenantSlug(req), query);
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename="permissions.csv"');
    res.send(csv);
  }

  @Get()
  @Permissions('system.permission.read')
  @ApiOperation({ summary: 'Get all permissions' })
  @ApiResponse({ status: 200, description: 'List of permissions' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: PermissionQueryDto) {
    return this.permissionsService.findAll(this.getTenantSlug(req), query);
  }

  @Get(':id')
  @Permissions('system.permission.read')
  @ApiOperation({ summary: 'Get a permission by ID' })
  @ApiResponse({ status: 200, description: 'The permission' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.permissionsService.findOne(this.getTenantSlug(req), id);
  }

  @Patch(':id')
  @Permissions('system.permission.write')
  @ApiOperation({ summary: 'Update a permission' })
  @ApiResponse({ status: 200, description: 'The updated permission' })
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() updatePermissionDto: UpdatePermissionDto) {
    return this.permissionsService.update(this.getTenantSlug(req), id, updatePermissionDto);
  }

  @Delete(':id')
  @Permissions('system.permission.write')
  @ApiOperation({ summary: 'Delete a permission' })
  @ApiResponse({ status: 200, description: 'The permission has been successfully deleted.' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.permissionsService.remove(this.getTenantSlug(req), id);
  }

  @Post('bulk-delete')
  @Permissions('system.permission.write')
  @ApiOperation({ summary: 'Delete multiple permissions' })
  @ApiResponse({ status: 200, description: 'Permissions have been successfully deleted.' })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } } })
  bulkRemove(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.permissionsService.removeMany(this.getTenantSlug(req), body.ids);
  }
}
