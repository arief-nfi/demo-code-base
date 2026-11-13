import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, Res, BadRequestException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleQueryDto } from './dto/role-query.dto';
import { JwtAuthGuard, RbacGuard, Roles, Permissions } from '@saas/backend';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '@saas/backend';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('system/roles')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('ADMIN')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Post()
  @Permissions('system.role.write')
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'The role has been successfully created.' })
  create(@Req() req: AuthenticatedRequest, @Body() createRoleDto: CreateRoleDto) {
    if (createRoleDto.name?.toUpperCase() === 'SYSADMIN') {
      throw new BadRequestException('Role name "SYSADMIN" is reserved and cannot be used.');
    }
    return this.rolesService.create(this.getTenantSlug(req), createRoleDto);
  }

  @Get('check-name')
  @Permissions('system.role.read')
  @ApiOperation({ summary: 'Check if role name is available' })
  @ApiResponse({ status: 200, description: 'Returns availability status' })
  checkName(@Req() req: AuthenticatedRequest, @Query('name') name: string, @Query('excludeId') excludeId?: string) {
    return this.rolesService.checkNameAvailability(this.getTenantSlug(req), name, excludeId);
  }

  @Get('export')
  @Permissions('system.role.read')
  @ApiOperation({ summary: 'Export roles to CSV' })
  @ApiResponse({ status: 200, description: 'CSV file' })
  async export(@Req() req: AuthenticatedRequest, @Query() query: RoleQueryDto, @Res() res: Response) {
    const csv = await this.rolesService.export(this.getTenantSlug(req), query);
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename="roles.csv"');
    res.send(csv);
  }

  @Get()
  @Permissions('system.role.read')
  @ApiOperation({ summary: 'Get all roles' })
  @ApiResponse({ status: 200, description: 'List of roles' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: RoleQueryDto) {
    return this.rolesService.findAll(this.getTenantSlug(req), query);
  }

  @Get(':id')
  @Permissions('system.role.read')
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ status: 200, description: 'The role' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.rolesService.findOne(this.getTenantSlug(req), id);
  }

  @Patch(':id')
  @Permissions('system.role.write')
  @ApiOperation({ summary: 'Update a role' })
  @ApiResponse({ status: 200, description: 'The updated role' })
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    if (updateRoleDto.name?.toUpperCase() === 'SYSADMIN') {
      throw new BadRequestException('Role name "SYSADMIN" is reserved and cannot be used.');
    }
    return this.rolesService.update(this.getTenantSlug(req), id, updateRoleDto);
  }

  @Delete(':id')
  @Permissions('system.role.write')
  @ApiOperation({ summary: 'Delete a role' })
  @ApiResponse({ status: 200, description: 'The role has been successfully deleted.' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.rolesService.remove(this.getTenantSlug(req), id);
  }

  @Post('bulk-delete')
  @Permissions('system.role.write')
  @ApiOperation({ summary: 'Delete multiple roles' })
  @ApiResponse({ status: 200, description: 'Roles have been successfully deleted.' })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } } })
  bulkRemove(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.rolesService.removeMany(this.getTenantSlug(req), body.ids);
  }
}
