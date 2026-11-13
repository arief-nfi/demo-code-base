import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@saas/backend';
import { QUEUE_NAMES } from '@saas/backend';
import type { ExportJobData } from './export.producer';

@Processor(QUEUE_NAMES.EXPORT)
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<ExportJobData>): Promise<{ exportedAt: string; tenantSlug: string; recordCount: number }> {
    const { tenantId, tenantSlug } = job.data;

    this.logger.log(`Processing export job ${job.id}: tenant=${tenantSlug}`);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    const tenantClient = this.prisma.getTenantClient(tenantSlug);

    await job.updateProgress(10);

    const [users, roles, permissions, config, plugins, subscriptions, auditLogs] = await Promise.all([
      tenantClient.user.findMany({ select: { id: true, email: true, username: true, name: true, status: true, createdAt: true } }),
      tenantClient.role.findMany({ include: { permissions: { select: { name: true } } } }),
      tenantClient.permission.findMany({ select: { name: true, description: true } }),
      tenantClient.tenantConfig.findFirst(),
      tenantClient.plugin.findMany(),
      tenantClient.tenantSubscription.findMany(),
      tenantClient.auditLog.findMany({ take: 10000, orderBy: { timestamp: 'desc' } }),
    ]);

    await job.updateProgress(80);

    const result = {
      exportedAt: new Date().toISOString(),
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      data: {
        users,
        roles: roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.name) })),
        permissions,
        config,
        plugins,
        subscriptions,
        auditLogs,
      },
    };

    // Store result on the job for retrieval
    await job.updateProgress(100);

    const recordCount = users.length + roles.length + permissions.length + auditLogs.length;
    this.logger.log(`Export job ${job.id} completed: ${recordCount} records`);

    return { exportedAt: result.exportedAt, tenantSlug, recordCount };
  }
}
