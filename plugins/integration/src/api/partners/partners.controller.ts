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
import { createPartnerSchema } from './dto/create-partner.dto';
import type { CreatePartnerDto } from './dto/create-partner.dto';
import { updatePartnerSchema } from './dto/update-partner.dto';
import type { UpdatePartnerDto } from './dto/update-partner.dto';
import type { PartnerQueryDto } from './dto/partner-query.dto';
import { partnerStatusSchema } from './dto/partner-status.dto';
import type { PartnerStatusDto } from './dto/partner-status.dto';
import { PartnersService } from './partners.service';

@ApiTags('Integration - Partners')
@ApiBearerAuth()
@Controller('plugins/integration/partners')
@PluginKey('integration')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('integration.partner.read')
  @ApiOperation({ summary: 'Get all partners' })
  @ApiResponse({ status: 200, description: 'Return all partners' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: PartnerQueryDto) {
    return this.partnersService.findAll(this.getTenantSlug(req), query);
  }

  @Get('check-code')
  @Permissions('integration.partner.read')
  @ApiOperation({ summary: 'Check if partner code is available' })
  @ApiResponse({ status: 200, description: 'Return availability status' })
  async checkCode(
    @Req() req: AuthenticatedRequest,
    @Query('code') code: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const available = await this.partnersService.checkCodeAvailable(code, excludeId, this.getTenantSlug(req));
    return { available };
  }

  @Get(':id')
  @Permissions('integration.partner.read')
  @ApiOperation({ summary: 'Get a partner by ID' })
  @ApiResponse({ status: 200, description: 'Return a partner' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.partnersService.findOne(id, this.getTenantSlug(req));
  }

  @Post()
  @Permissions('integration.partner.write')
  @ApiOperation({ summary: 'Create a new partner' })
  @ApiResponse({ status: 201, description: 'Partner created successfully' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createPartnerSchema)) dto: CreatePartnerDto,
  ) {
    return this.partnersService.create(dto, this.getTenantSlug(req));
  }

  @Patch(':id')
  @Permissions('integration.partner.write')
  @ApiOperation({ summary: 'Update a partner' })
  @ApiResponse({ status: 200, description: 'Partner updated successfully' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePartnerSchema)) dto: UpdatePartnerDto,
  ) {
    return this.partnersService.update(id, dto, this.getTenantSlug(req));
  }

  @Delete(':id')
  @Permissions('integration.partner.write')
  @ApiOperation({ summary: 'Delete a partner' })
  @ApiResponse({ status: 200, description: 'Partner deleted successfully' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.partnersService.remove(id, this.getTenantSlug(req)).then(() => ({ message: 'Partner deleted successfully' }));
  }

  @Post('bulk-delete')
  @Permissions('integration.partner.write')
  @ApiOperation({ summary: 'Delete multiple partners' })
  @ApiResponse({ status: 200, description: 'Partners deleted successfully' })
  bulkDelete(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.partnersService.bulkDelete(body.ids, this.getTenantSlug(req)).then(() => ({ message: 'Partners deleted successfully' }));
  }

  @Patch(':id/status')
  @Permissions('integration.partner.write')
  @ApiOperation({ summary: 'Update partner status' })
  @ApiResponse({ status: 200, description: 'Partner status updated successfully' })
  updateStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(partnerStatusSchema)) dto: PartnerStatusDto,
  ) {
    return this.partnersService.updateStatus(id, dto.status, this.getTenantSlug(req));
  }
}
