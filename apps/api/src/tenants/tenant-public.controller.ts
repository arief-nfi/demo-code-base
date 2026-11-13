import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service';
import { ZodValidationPipe } from '@saas/backend';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { registerTenantSchema, RegisterTenantDto } from './dto/register-tenant.dto';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantPublicController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('branding/:slug')
  @ApiOperation({ summary: 'Get public branding for a tenant (no auth required)' })
  getPublicBranding(@Param('slug') slug: string) {
    return this.tenantsService.getPublicBranding(slug);
  }

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Public self-registration for new tenants' })
  @ApiResponse({ status: 201, description: 'Tenant registered successfully' })
  register(@Body(new ZodValidationPipe(registerTenantSchema)) dto: RegisterTenantDto) {
    return this.tenantsService.registerTenant(dto);
  }
}
