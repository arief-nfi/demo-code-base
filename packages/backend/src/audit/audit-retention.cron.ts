import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { AuditConfigService } from './audit-config.service';
import { AuditRetentionPolicy, DEFAULT_RETENTION_POLICY } from './audit.config';

export interface RetentionRunResult {
  tenantSlug: string;
  deleted: number;
  error?: string;
}

@Injectable()
export class AuditRetentionCron {
  private readonly logger = new Logger(AuditRetentionCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly auditConfigService: AuditConfigService,
  ) {}

  /** Check if a retention job is currently running */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Scheduled retention job — runs daily at 2 AM.
   * Reads per-tenant retention policy from DB and processes all active tenants.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleRetention(): Promise<RetentionRunResult[]> {
    if (this.running) {
      this.logger.warn('Retention job already running — skipping');
      return [];
    }

    this.running = true;
    const results: RetentionRunResult[] = [];

    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { slug: true },
      });

      this.logger.log(`Starting scheduled retention for ${tenants.length} tenant(s)`);

      for (const tenant of tenants) {
        const config = await this.auditConfigService.getConfig(tenant.slug);
        const policy = config.retentionPolicy ?? DEFAULT_RETENTION_POLICY;

        if (!policy.enabled) {
          continue;
        }

        try {
          const deleted = await this.applyPolicyForTenant(tenant.slug, policy);
          results.push({ tenantSlug: tenant.slug, deleted });

          if (deleted > 0) {
            this.logger.log(`Tenant "${tenant.slug}": cleaned ${deleted} audit log(s)`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Tenant "${tenant.slug}": retention failed — ${message}`);
          results.push({ tenantSlug: tenant.slug, deleted: 0, error: message });
        }
      }

      const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
      const failedCount = results.filter((r) => r.error).length;
      this.logger.log(
        `Scheduled retention complete: ${totalDeleted} log(s) deleted across ${results.length} tenant(s)` +
        (failedCount > 0 ? `, ${failedCount} failed` : ''),
      );
    } finally {
      this.running = false;
    }

    return results;
  }

  /**
   * Apply a retention policy for a single tenant.
   */
  private async applyPolicyForTenant(
    tenantSlug: string,
    policy: AuditRetentionPolicy,
  ): Promise<number> {
    if (policy.type === 'time' && policy.retainDays) {
      const beforeDate = new Date();
      beforeDate.setDate(beforeDate.getDate() - policy.retainDays);

      return this.auditService.applyRetention(tenantSlug, {
        type: 'time',
        beforeDate,
        backup: policy.backup,
      });
    }

    if (policy.type === 'count' && policy.keepCount) {
      return this.auditService.applyRetention(tenantSlug, {
        type: 'count',
        keepCount: policy.keepCount,
        backup: policy.backup,
      });
    }

    return 0;
  }
}
