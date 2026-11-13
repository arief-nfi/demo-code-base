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
import { createWebhookEventSchema } from './dto/create-webhook-event.dto';
import type { CreateWebhookEventDto } from './dto/create-webhook-event.dto';
import { updateWebhookEventSchema } from './dto/update-webhook-event.dto';
import type { UpdateWebhookEventDto } from './dto/update-webhook-event.dto';
import type { WebhookEventQueryDto } from './dto/webhook-event-query.dto';
import { WebhookEventsService } from './webhook-events.service';

@ApiTags('Integration - Webhook Events')
@ApiBearerAuth()
@Controller('plugins/integration/webhook-events')
@PluginKey('integration')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class WebhookEventsController {
  constructor(private readonly webhookEventsService: WebhookEventsService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('integration.webhook-event.read')
  @ApiOperation({ summary: 'Get all webhook events' })
  @ApiResponse({ status: 200, description: 'Return all webhook events' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: WebhookEventQueryDto) {
    return this.webhookEventsService.findAll(this.getTenantSlug(req), query);
  }

  @Get('check-code')
  @Permissions('integration.webhook-event.read')
  @ApiOperation({ summary: 'Check if webhook event code is available' })
  @ApiResponse({ status: 200, description: 'Return availability status' })
  async checkCode(
    @Req() req: AuthenticatedRequest,
    @Query('code') code: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const available = await this.webhookEventsService.checkCodeAvailable(code, excludeId, this.getTenantSlug(req));
    return { available };
  }

  @Get(':id')
  @Permissions('integration.webhook-event.read')
  @ApiOperation({ summary: 'Get a webhook event by ID' })
  @ApiResponse({ status: 200, description: 'Return a webhook event' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.webhookEventsService.findOne(id, this.getTenantSlug(req));
  }

  @Post()
  @Permissions('integration.webhook-event.write')
  @ApiOperation({ summary: 'Create a new webhook event' })
  @ApiResponse({ status: 201, description: 'Webhook event created successfully' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createWebhookEventSchema)) dto: CreateWebhookEventDto,
  ) {
    return this.webhookEventsService.create(dto, this.getTenantSlug(req));
  }

  @Patch(':id')
  @Permissions('integration.webhook-event.write')
  @ApiOperation({ summary: 'Update a webhook event' })
  @ApiResponse({ status: 200, description: 'Webhook event updated successfully' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWebhookEventSchema)) dto: UpdateWebhookEventDto,
  ) {
    return this.webhookEventsService.update(id, dto, this.getTenantSlug(req));
  }

  @Delete(':id')
  @Permissions('integration.webhook-event.write')
  @ApiOperation({ summary: 'Delete a webhook event' })
  @ApiResponse({ status: 200, description: 'Webhook event deleted successfully' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.webhookEventsService.remove(id, this.getTenantSlug(req)).then(() => ({ message: 'Webhook event deleted successfully' }));
  }

  @Post('bulk-delete')
  @Permissions('integration.webhook-event.write')
  @ApiOperation({ summary: 'Delete multiple webhook events' })
  @ApiResponse({ status: 200, description: 'Webhook events deleted successfully' })
  bulkDelete(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.webhookEventsService.bulkDelete(body.ids, this.getTenantSlug(req)).then(() => ({ message: 'Webhook events deleted successfully' }));
  }
}
