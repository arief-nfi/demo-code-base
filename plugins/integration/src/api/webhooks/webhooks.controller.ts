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
import { createWebhookSchema } from './dto/create-webhook.dto';
import type { CreateWebhookDto } from './dto/create-webhook.dto';
import { updateWebhookSchema } from './dto/update-webhook.dto';
import type { UpdateWebhookDto } from './dto/update-webhook.dto';
import type { WebhookQueryDto } from './dto/webhook-query.dto';
import type { DeliveryQueryDto } from './dto/delivery-query.dto';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

@ApiTags('Integration - Webhooks')
@ApiBearerAuth()
@Controller('plugins/integration/webhooks')
@PluginKey('integration')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly deliveryService: WebhookDeliveryService,
  ) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('integration.webhook.read')
  @ApiOperation({ summary: 'Get all webhooks' })
  @ApiResponse({ status: 200, description: 'Return all webhooks' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: WebhookQueryDto) {
    return this.webhooksService.findAll(this.getTenantSlug(req), query);
  }

  @Get(':id')
  @Permissions('integration.webhook.read')
  @ApiOperation({ summary: 'Get a webhook by ID' })
  @ApiResponse({ status: 200, description: 'Return a webhook' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.webhooksService.findOne(id, this.getTenantSlug(req));
  }

  @Post()
  @Permissions('integration.webhook.write')
  @ApiOperation({ summary: 'Create a new webhook' })
  @ApiResponse({ status: 201, description: 'Webhook created successfully. Secret returned once.' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createWebhookSchema)) dto: CreateWebhookDto,
  ) {
    return this.webhooksService.create(dto, this.getTenantSlug(req));
  }

  @Patch(':id')
  @Permissions('integration.webhook.write')
  @ApiOperation({ summary: 'Update a webhook' })
  @ApiResponse({ status: 200, description: 'Webhook updated successfully' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(id, dto, this.getTenantSlug(req));
  }

  @Delete(':id')
  @Permissions('integration.webhook.write')
  @ApiOperation({ summary: 'Delete a webhook' })
  @ApiResponse({ status: 200, description: 'Webhook deleted successfully' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.webhooksService.remove(id, this.getTenantSlug(req)).then(() => ({ message: 'Webhook deleted successfully' }));
  }

  @Post('bulk-delete')
  @Permissions('integration.webhook.write')
  @ApiOperation({ summary: 'Delete multiple webhooks' })
  @ApiResponse({ status: 200, description: 'Webhooks deleted successfully' })
  bulkDelete(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    return this.webhooksService.bulkDelete(body.ids, this.getTenantSlug(req)).then(() => ({ message: 'Webhooks deleted successfully' }));
  }

  @Post(':id/rotate-secret')
  @Permissions('integration.webhook.write')
  @ApiOperation({ summary: 'Rotate webhook secret' })
  @ApiResponse({ status: 200, description: 'Secret rotated. New secret returned once.' })
  rotateSecret(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.webhooksService.rotateSecret(id, this.getTenantSlug(req));
  }

  @Post(':id/test')
  @Permissions('integration.webhook.write')
  @ApiOperation({ summary: 'Send a test delivery' })
  @ApiResponse({ status: 200, description: 'Test delivery sent' })
  testWebhook(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.webhooksService.testWebhook(id, this.getTenantSlug(req));
  }

  @Get(':id/deliveries')
  @Permissions('integration.webhook.read')
  @ApiOperation({ summary: 'Get delivery log for a webhook' })
  @ApiResponse({ status: 200, description: 'Return delivery log' })
  findDeliveries(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: DeliveryQueryDto,
  ) {
    return this.deliveryService.findDeliveries(id, this.getTenantSlug(req), query);
  }

  @Post(':id/deliveries/:deliveryId/retry')
  @Permissions('integration.webhook.write')
  @ApiOperation({ summary: 'Retry a failed delivery' })
  @ApiResponse({ status: 200, description: 'Delivery retry initiated' })
  retryDelivery(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.deliveryService.retryDelivery(id, deliveryId, this.getTenantSlug(req));
  }
}
