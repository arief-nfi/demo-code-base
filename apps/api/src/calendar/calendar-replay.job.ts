import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@saas/backend';
import { CalendarSyncService } from './calendar-sync.service';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Queues the calendar requests recorded while syncing was paused (plugin disabled,
 * subscription lapsed, tenant switched sync off, Redis down) once they can sync again.
 */
@Injectable()
export class CalendarReplayJob {
  private readonly logger = new Logger(CalendarReplayJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendarSync: CalendarSyncService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron(): Promise<void> {
    const result = await this.run();
    if (result.errors.length) {
      this.logger.warn(`Calendar replay finished with ${result.errors.length} error(s): ${JSON.stringify(result.errors)}`);
    }
  }

  async run(): Promise<{ queued: number; errors: Array<{ tenantSlug: string; error: string }> }> {
    const result = { queued: 0, errors: [] as Array<{ tenantSlug: string; error: string }> };
    const tenants = await this.prisma.tenant.findMany({ select: { slug: true } });
    for (const { slug } of tenants) {
      try {
        result.queued += await this.calendarSync.resync(slug);
      } catch (error) {
        result.errors.push({ tenantSlug: slug, error: errorText(error) });
      }
    }
    return result;
  }
}
