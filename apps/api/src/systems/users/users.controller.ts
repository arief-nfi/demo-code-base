import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, Res } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { JwtAuthGuard, RbacGuard, Roles, Permissions } from '@saas/backend';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '@saas/backend';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('system/users')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Post()
  @Permissions('system.user.write')
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'The user has been successfully created.' })
  create(@Req() req: AuthenticatedRequest, @Body() createUserDto: CreateUserDto) {
    return this.usersService.create(this.getTenantSlug(req), createUserDto);
  }

  @Get('check-username')
  @Permissions('system.user.read')
  @ApiOperation({ summary: 'Check if username is available' })
  @ApiResponse({ status: 200, description: 'Returns availability status' })
  checkUsername(@Req() req: AuthenticatedRequest, @Query('username') username: string, @Query('excludeId') excludeId?: string) {
    return this.usersService.checkUsernameAvailability(this.getTenantSlug(req), username, excludeId);
  }

  @Get('check-email')
  @Permissions('system.user.read')
  @ApiOperation({ summary: 'Check if email is available' })
  @ApiResponse({ status: 200, description: 'Returns availability status' })
  checkEmail(@Req() req: AuthenticatedRequest, @Query('email') email: string, @Query('excludeId') excludeId?: string) {
    return this.usersService.checkEmailAvailability(this.getTenantSlug(req), email, excludeId);
  }

  @Get('export')
  @Permissions('system.user.read')
  @ApiOperation({ summary: 'Export users (CSV, Excel, JSON)' })
  @ApiResponse({ status: 200, description: 'Exported file' })
  async export(
    @Req() req: AuthenticatedRequest,
    @Query() query: UserQueryDto,
    @Query('format') format: string = 'csv',
    @Res() res: Response,
  ) {
    const validFormat = (['csv', 'xlsx', 'json'].includes(format) ? format : 'csv') as 'csv' | 'xlsx' | 'json';
    const result = await this.usersService.exportUsers(this.getTenantSlug(req), query, validFormat);
    res.header('Content-Type', result.contentType);
    res.header('Content-Disposition', `attachment; filename="users.${result.extension}"`);
    res.send(result.data);
  }

  @Get()
  @Permissions('system.user.read')
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of users' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: UserQueryDto) {
    return this.usersService.findAll(this.getTenantSlug(req), query);
  }

  @Get(':id')
  @Permissions('system.user.read')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200, description: 'The user' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.usersService.findOne(this.getTenantSlug(req), id);
  }

  @Patch(':id')
  @Permissions('system.user.write')
  @ApiOperation({ summary: 'Update a user' })
  @ApiResponse({ status: 200, description: 'The updated user' })
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(this.getTenantSlug(req), id, updateUserDto);
  }

  @Delete(':id')
  @Permissions('system.user.write')
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({ status: 200, description: 'The user has been successfully deleted.' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.usersService.remove(this.getTenantSlug(req), id);
  }

  @Post('bulk-delete')
  @Permissions('system.user.write')
  @ApiOperation({ summary: 'Delete multiple users' })
  @ApiResponse({ status: 200, description: 'Users have been successfully deleted.' })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } } })
  bulkRemove(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.usersService.removeMany(this.getTenantSlug(req), body.ids);
  }
}
