import { BadRequestException, Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RbacGuard, Roles } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { TenantAppsService, type AppPreview, type MenuApp, type StoreApp } from './tenant-apps.service';

/** Apps for the caller's tenant (from x-tenant-id): the store and previews for admins, the menu for everyone. */
@ApiTags('Apps')
@ApiBearerAuth()
@Controller('tenant-apps')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TenantAppsController {
  constructor(private readonly apps: TenantAppsService) {}

  private tenantOf(req: AuthenticatedRequest): { id: string; slug: string } {
    if (!req.tenant?.id) throw new BadRequestException('Tenant context is required');
    return { id: req.tenant.id, slug: req.tenant.slug };
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Apps the tenant can buy or already has' })
  store(@Req() req: AuthenticatedRequest): Promise<StoreApp[]> {
    const tenant = this.tenantOf(req);
    return this.apps.store(tenant.slug, tenant.id);
  }

  // Static route before `:key`; any signed-in tenant user (the sidebar needs it)
  @Get('menu')
  @ApiOperation({ summary: "The tenant's live apps and the plugins they grant, for the sidebar" })
  menu(@Req() req: AuthenticatedRequest): Promise<MenuApp[]> {
    return this.apps.menu(this.tenantOf(req).slug);
  }

  @Get(':key/preview')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'What buying the app would do to the plugins the tenant already has' })
  preview(@Req() req: AuthenticatedRequest, @Param('key') key: string): Promise<AppPreview> {
    const tenant = this.tenantOf(req);
    return this.apps.preview(tenant.slug, tenant.id, key);
  }
}
