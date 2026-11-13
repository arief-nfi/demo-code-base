import { Logger } from '@nestjs/common';
import { PrismaClient } from '@saas/database';
import type {
  PluginLifecycle,
  PluginLifecycleContext,
  PluginHealthStatus,
} from '@saas/backend';

const logger = new Logger('IntegrationLifecycle');

/**
 * Create a short-lived PrismaClient for a tenant schema.
 * Used by lifecycle hooks which run outside NestJS DI.
 */
function createTenantClient(tenantSlug: string): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not defined');
  }

  const url = new URL(databaseUrl);
  url.searchParams.set(
    'schema',
    `tenant_${tenantSlug.replace(/-/g, '_')}`,
  );

  return new PrismaClient({
    datasources: { db: { url: url.toString() } },
  });
}

/**
 * Seed default webhook events (idempotent via upsert).
 * Called from both onInstall and onActivate so events exist
 * regardless of whether the plugin was freshly installed or re-enabled.
 */
async function seedDefaultWebhookEvents(context: PluginLifecycleContext): Promise<void> {
  const client = createTenantClient(context.tenantSlug);
  try {
    const defaultEvents = [
      {
        code: 'plugin.enabled',
        name: 'Plugin Enabled',
        description: 'Triggered when a tenant admin activates (enables) an installed plugin.',
        category: 'plugin',
        payloadSchema: {
          type: 'object',
          properties: {
            pluginKey: { type: 'string', description: 'Unique key of the plugin' },
            tenantSlug: { type: 'string', description: 'Tenant identifier' },
            enabledAt: { type: 'string', format: 'date-time', description: 'Timestamp of activation' },
          },
          required: ['pluginKey', 'tenantSlug', 'enabledAt'],
        },
        samplePayload: {
          pluginKey: 'sample-plugin',
          tenantSlug: context.tenantSlug,
          enabledAt: new Date().toISOString(),
        },
      },
      {
        code: 'plugin.disabled',
        name: 'Plugin Disabled',
        description: 'Triggered when a tenant admin deactivates (disables) an installed plugin.',
        category: 'plugin',
        payloadSchema: {
          type: 'object',
          properties: {
            pluginKey: { type: 'string', description: 'Unique key of the plugin' },
            tenantSlug: { type: 'string', description: 'Tenant identifier' },
            disabledAt: { type: 'string', format: 'date-time', description: 'Timestamp of deactivation' },
          },
          required: ['pluginKey', 'tenantSlug', 'disabledAt'],
        },
        samplePayload: {
          pluginKey: 'sample-plugin',
          tenantSlug: context.tenantSlug,
          disabledAt: new Date().toISOString(),
        },
      },
    ];

    for (const evt of defaultEvents) {
      await client.integrationWebhookEvent.upsert({
        where: { code: evt.code },
        update: {},
        create: evt,
      });
    }

    logger.log(`[tenant:${context.tenantSlug}] Seeded ${defaultEvents.length} default webhook events`);
  } finally {
    await client.$disconnect();
  }
}

export const IntegrationLifecycle: PluginLifecycle = {
  async onInstall(context: PluginLifecycleContext): Promise<void> {
    logger.log(
      `[tenant:${context.tenantSlug}] Integration plugin installed (v${context.pluginVersion})`,
    );
    await seedDefaultWebhookEvents(context);
  },

  async onActivate(context: PluginLifecycleContext): Promise<void> {
    logger.log(
      `[tenant:${context.tenantSlug}] Integration plugin activated`,
    );
    await seedDefaultWebhookEvents(context);
  },

  async onDeactivate(context: PluginLifecycleContext): Promise<void> {
    logger.log(
      `[tenant:${context.tenantSlug}] Integration plugin deactivating...`,
    );

    const client = createTenantClient(context.tenantSlug);

    try {
      // Revoke all active API keys (security measure)
      const revokedKeys = await client.integrationApiKey.updateMany({
        where: { isActive: true },
        data: { isActive: false, revokedAt: new Date() },
      });

      // Deactivate all active webhooks (stop deliveries)
      const deactivatedWebhooks =
        await client.integrationWebhook.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });

      logger.log(
        `[tenant:${context.tenantSlug}] Deactivated: ${revokedKeys.count} API keys revoked, ${deactivatedWebhooks.count} webhooks disabled`,
      );
    } finally {
      await client.$disconnect();
    }
  },

  async healthCheck(
    context: PluginLifecycleContext,
  ): Promise<PluginHealthStatus> {
    const client = createTenantClient(context.tenantSlug);

    try {
      // Check: can query partners table
      const partnerCount = await client.integrationPartner.count();

      // Check: no stuck retrying deliveries older than 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const stuckDeliveries =
        await client.integrationWebhookDelivery.count({
          where: {
            status: 'RETRYING',
            nextRetryAt: { lt: oneHourAgo },
          },
        });

      if (stuckDeliveries > 0) {
        return {
          status: 'degraded',
          message: `${stuckDeliveries} stuck retrying deliveries found`,
          details: { partnerCount, stuckDeliveries },
          checkedAt: new Date(),
        };
      }

      return {
        status: 'healthy',
        message: 'Integration plugin operational',
        details: { partnerCount },
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message:
          error instanceof Error
            ? error.message
            : 'Unknown error during health check',
        checkedAt: new Date(),
      };
    } finally {
      await client.$disconnect();
    }
  },

  getDefaultConfig(): Record<string, unknown> {
    return {
      webhookTimeoutMs: 10000,
      maxApiKeysPerPartner: 10,
      deliveryRetentionDays: 30,
    };
  },
};
