import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@saas/backend';
import { EMAIL_ENV, type EmailEnv } from './email-env';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Deletes logged emails older than EMAIL_LOG_RETENTION_DAYS, and marks emails that
 * never got a delivery result (lost from the queue) as FAILED — in public and every
 * tenant schema.
 */
@Injectable()
export class EmailRetentionJob {
  private readonly logger = new Logger(EmailRetentionJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_ENV) private readonly env: EmailEnv,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    const result = await this.run();
    if (result.errors.length) {
      this.logger.warn(`Email log cleanup finished with ${result.errors.length} error(s): ${JSON.stringify(result.errors)}`);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleSweep(): Promise<void> {
    const result = await this.sweepStuck();
    if (result.marked > 0) this.logger.warn(`${result.marked} email(s) had no delivery result after an hour and were marked FAILED`);
    if (result.errors.length) this.logger.warn(`Stuck-email sweep finished with ${result.errors.length} error(s): ${JSON.stringify(result.errors)}`);
  }

  /**
   * A job finishes in seconds (three attempts over ~15 s). An email still QUEUED an hour
   * after it was queued was lost (API crash before queueing, Redis data loss): mark it
   * FAILED so the log says so and a failed non-redacted email can be retried.
   */
  async sweepStuck(now: Date = new Date()): Promise<{ marked: number; errors: Array<{ tenantSlug: string | null; error: string }> }> {
    const args = {
      where: { status: 'QUEUED' as const, queuedAt: { lt: new Date(now.getTime() - HOUR) } },
      data: { status: 'FAILED' as const, lastError: 'No delivery result after an hour: the email was lost from the queue' },
    };
    const result = { marked: 0, errors: [] as Array<{ tenantSlug: string | null; error: string }> };
    for (const tenantSlug of [null, ...(await this.tenantSlugs())]) {
      try {
        result.marked += (await (tenantSlug ? this.prisma.getTenantClient(tenantSlug) : this.prisma).emailMessage.updateMany(args)).count;
      } catch (error) {
        result.errors.push({ tenantSlug, error: errorText(error) });
      }
    }
    return result;
  }

  private async tenantSlugs(): Promise<string[]> {
    return (await this.prisma.tenant.findMany({ select: { slug: true } })).map((t) => t.slug);
  }

  async run(now: Date = new Date()): Promise<{ deleted: number; errors: Array<{ tenantSlug: string | null; error: string }> }> {
    const where = { createdAt: { lt: new Date(now.getTime() - this.env.retentionDays * DAY) } };
    const result = { deleted: 0, errors: [] as Array<{ tenantSlug: string | null; error: string }> };

    try {
      result.deleted += (await this.prisma.emailMessage.deleteMany({ where })).count;
    } catch (error) {
      result.errors.push({ tenantSlug: null, error: errorText(error) });
    }

    // Every tenant, whatever its status: suspended tenants' logs age out too
    const tenants = await this.prisma.tenant.findMany({ select: { slug: true } });
    for (const { slug } of tenants) {
      try {
        result.deleted += (await this.prisma.getTenantClient(slug).emailMessage.deleteMany({ where })).count;
      } catch (error) {
        result.errors.push({ tenantSlug: slug, error: errorText(error) });
      }
    }
    return result;
  }
}
