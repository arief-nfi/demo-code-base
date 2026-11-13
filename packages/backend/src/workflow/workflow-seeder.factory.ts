import { PrismaClient } from '@saas/database';
import type { WorkflowStepSeed } from './workflow.types';

/**
 * Creates a minimal workflow seeder for use in plugin lifecycle hooks.
 *
 * Lifecycle hooks run outside NestJS DI — they cannot use WorkflowService.
 * This factory accepts a raw PrismaClient and provides only seedProcess().
 * Cache invalidation and event emission are NOT performed here;
 * they are handled by WorkflowService during normal request flow.
 *
 * Usage in plugin lifecycle.ts:
 * ```typescript
 * const client = createTenantClient(context.tenantSlug);
 * const seeder = createWorkflowSeeder(client);
 * try {
 *   await seeder.seedProcess('my-plugin', 'my-plugin.orders', 'Order Flow', [...]);
 * } finally {
 *   await client.$disconnect();
 * }
 * ```
 */
export function createWorkflowSeeder(client: PrismaClient) {
  return {
    async seedProcess(
      pluginKey: string,
      processKey: string,
      name: string,
      steps: WorkflowStepSeed[],
    ): Promise<void> {
      const process = await client.workflowProcess.upsert({
        where: { pluginKey_processKey: { pluginKey, processKey } },
        update: { name },
        create: { pluginKey, processKey, name },
      });

      // Delete and recreate steps to handle step list changes on re-install
      await client.workflowStep.deleteMany({ where: { processId: process.id } });
      await client.workflowStep.createMany({
        data: steps.map((s) => ({
          processId: process.id,
          state: s.state,
          label: s.label,
          sortOrder: s.sortOrder,
          isMandatory: s.isMandatory ?? false,
          permissions: s.permissions ?? [],
          metadata: s.metadata,
        })),
      });
    },
  };
}
