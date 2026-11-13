import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  CacheService,
  OnPluginEvent,
  SystemEvents,
} from '@saas/backend';
import type { PluginEventPayload } from '@saas/backend';
import { WebhookDeliveryService } from './webhook-delivery.service';

/**
 * Listens to system events and triggers matching webhook deliveries
 * for tenants that have the integration plugin enabled.
 */
@Injectable()
export class WebhookEventListenerService {
  private readonly logger = new Logger(WebhookEventListenerService.name);

  constructor(
    readonly prisma: PrismaService,
    readonly cache: CacheService,
    private readonly deliveryService: WebhookDeliveryService,
  ) {}

  @OnPluginEvent(SystemEvents.PLUGIN_ENABLED_TENANT, 'integration')
  async onPluginEnabled(payload: PluginEventPayload) {
    await this.triggerWebhooks(payload.tenantSlug, 'plugin.enabled', {
      pluginKey: payload.pluginKey,
      tenantSlug: payload.tenantSlug,
      enabledAt: payload.timestamp.toISOString(),
    });
  }

  @OnPluginEvent(SystemEvents.PLUGIN_DISABLED_TENANT, 'integration')
  async onPluginDisabled(payload: PluginEventPayload) {
    await this.triggerWebhooks(payload.tenantSlug, 'plugin.disabled', {
      pluginKey: payload.pluginKey,
      tenantSlug: payload.tenantSlug,
      disabledAt: payload.timestamp.toISOString(),
    });
  }

  private async triggerWebhooks(
    tenantSlug: string,
    eventCode: string,
    payload: Record<string, unknown>,
  ) {
    const client = this.prisma.getTenantClient(tenantSlug);

    const event = await client.integrationWebhookEvent.findFirst({
      where: { code: eventCode, isActive: true },
    });

    if (!event) {
      this.logger.debug(`No active webhook event '${eventCode}' for tenant ${tenantSlug}`);
      return;
    }

    const webhooks = await client.integrationWebhook.findMany({
      where: { eventId: event.id, isActive: true },
    });

    if (webhooks.length === 0) {
      this.logger.debug(`No active webhooks registered for '${eventCode}' in tenant ${tenantSlug}`);
      return;
    }

    this.logger.log(`Triggering ${webhooks.length} webhook(s) for '${eventCode}' in tenant ${tenantSlug}`);

    const deliveryPromises = webhooks.map((webhook) =>
      this.deliveryService.deliverWebhook(
        {
          id: webhook.id,
          url: webhook.url,
          secret: webhook.secret,
          headers: webhook.headers as Record<string, string> | null,
          retryPolicy: webhook.retryPolicy as { maxAttempts: number; backoffMs: number; backoffMultiplier: number } | null,
        },
        eventCode,
        payload,
        tenantSlug,
      ),
    );

    const results = await Promise.allSettled(deliveryPromises);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger.warn(`${failed.length}/${webhooks.length} webhook deliveries failed for '${eventCode}'`);
    }
  }
}
