import { Logger } from '@nestjs/common';
import { PrismaClient } from '@saas/database';
import type { PluginLifecycle, PluginLifecycleContext } from '@saas/backend';
import { createWorkflowSeeder } from '@saas/backend';

const logger = new Logger('SamplePluginLifecycle');

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

async function seedWorkflows(ctx: PluginLifecycleContext): Promise<void> {
  const client = createTenantClient(ctx.tenantSlug);
  try {
    const seeder = createWorkflowSeeder(client);
    await seeder.seedProcess(
      ctx.pluginKey,
      'sample-plugin.items',
      'Sample Item Flow',
      [
        { state: 'CREATE',   label: 'Create',   sortOrder: 1, isMandatory: true },
        { state: 'REVIEW',   label: 'Review',   sortOrder: 2, permissions: ['sample-plugin.item.write'] },
        { state: 'ACTIVE',   label: 'Active',   sortOrder: 3, isMandatory: true },
        { state: 'ARCHIVED', label: 'Archived', sortOrder: 4, isMandatory: true },
      ],
    );
  } finally {
    await client.$disconnect();
  }
}

export const SamplePluginLifecycle: PluginLifecycle = {
  async onInstall(ctx: PluginLifecycleContext): Promise<void> {
    logger.log(`[tenant:${ctx.tenantSlug}] Sample plugin installed — seeding workflow`);
    await seedWorkflows(ctx);
  },

  async onActivate(ctx: PluginLifecycleContext): Promise<void> {
    logger.log(`[tenant:${ctx.tenantSlug}] Sample plugin activated — ensuring workflow exists`);
    await seedWorkflows(ctx);
  },

  async onDeactivate(ctx: PluginLifecycleContext): Promise<void> {
    logger.log(`[tenant:${ctx.tenantSlug}] Sample plugin deactivated`);
  },
};
