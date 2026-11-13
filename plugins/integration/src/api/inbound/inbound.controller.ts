import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  PluginEnabledGuard,
  PluginKey,
  ApiKeyAuthGuard,
  ApiKeyScopeGuard,
  RequiredScopes,
  ZodValidationPipe,
} from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { PrismaService } from '@saas/backend';
import { triggerWebhookSchema } from './dto/trigger-webhook.dto';
import type { TriggerWebhookDto } from './dto/trigger-webhook.dto';
import { WebhookDeliveryService } from '../webhooks/webhook-delivery.service';

@ApiTags('Integration - Inbound API')
@Controller('plugins/integration/inbounds')
@PluginKey('integration')
@UseGuards(PluginEnabledGuard, ApiKeyAuthGuard, ApiKeyScopeGuard)
export class InboundController {
  constructor(
    private readonly deliveryService: WebhookDeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Post('webhook-trigger')
  @RequiredScopes('webhook.trigger', '*')
  @ApiOperation({ summary: 'Trigger webhook deliveries for an event' })
  @ApiResponse({ status: 200, description: 'Webhook deliveries accepted' })
  async triggerWebhook(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(triggerWebhookSchema)) dto: TriggerWebhookDto,
  ) {
    const tenantSlug = this.getTenantSlug(req);
    const partnerId = req.partner?.id;
    const client = this.prisma.getTenantClient(tenantSlug);

    const event = await client.integrationWebhookEvent.findFirst({
      where: { code: dto.eventCode, isActive: true },
    });

    if (!event) {
      return { accepted: false, message: `Event '${dto.eventCode}' not found or inactive`, deliveries: 0 };
    }

    const webhooks = await client.integrationWebhook.findMany({
      where: {
        eventId: event.id,
        isActive: true,
        ...(partnerId ? { partnerId } : {}),
      },
    });

    const deliveryPromises = webhooks.map((webhook) =>
      this.deliveryService.deliverWebhook(
        {
          id: webhook.id,
          url: webhook.url,
          secret: webhook.secret,
          headers: webhook.headers as Record<string, string> | null,
          retryPolicy: webhook.retryPolicy as { maxAttempts: number; backoffMs: number; backoffMultiplier: number } | null,
        },
        dto.eventCode,
        dto.payload as Record<string, unknown>,
        tenantSlug,
      ),
    );

    await Promise.allSettled(deliveryPromises);

    return { accepted: true, deliveries: webhooks.length };
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check for API key authentication' })
  @ApiResponse({ status: 200, description: 'API key is valid' })
  health(@Req() req: AuthenticatedRequest) {
    return {
      status: 'ok',
      partner: req.partner?.code,
      timestamp: new Date().toISOString(),
    };
  }
}
