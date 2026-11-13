import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@saas/backend';
import { MeetingService } from './meeting.service';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Retries meeting locks that couldn't be applied when the app stopped managing a meeting. */
@Injectable()
export class MeetingLockJob {
  private readonly logger = new Logger(MeetingLockJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron(): Promise<void> {
    const result = await this.run();
    if (result.errors.length) {
      this.logger.warn(`Meeting lock retry finished with ${result.errors.length} error(s): ${JSON.stringify(result.errors)}`);
    }
  }

  async run(): Promise<{ locked: number; errors: Array<{ tenantSlug: string; error: string }> }> {
    const result = { locked: 0, errors: [] as Array<{ tenantSlug: string; error: string }> };
    const tenants = await this.prisma.tenant.findMany({ select: { slug: true } });
    for (const { slug } of tenants) {
      try {
        result.locked += await this.meetings.retryPendingLocks(slug);
      } catch (error) {
        result.errors.push({ tenantSlug: slug, error: errorText(error) });
      }
    }
    return result;
  }
}
