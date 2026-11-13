import { Injectable } from '@nestjs/common';
import { CacheService, OnPluginEvent, PrismaService, SystemEvents, type CalendarConnectionEvent } from '@saas/backend';
import { SampleArticlesService } from './sample-articles.service';

const BACKFILL_LIMIT = 100;

/** When someone connects a calendar, their recent published articles go onto it. */
@Injectable()
export class SampleArticlesCalendarListener {
  // OnPluginEvent reads prisma and cache from the instance to skip tenants with the plugin off
  constructor(
    readonly prisma: PrismaService,
    readonly cache: CacheService,
    private readonly articles: SampleArticlesService,
  ) {}

  @OnPluginEvent(SystemEvents.INTEGRATION_CALENDAR_CONNECTED, 'sample-plugin')
  async onCalendarConnected(event: CalendarConnectionEvent): Promise<void> {
    const rows = await this.prisma.getTenantClient(event.tenantSlug).sampleArticle.findMany({
      where: { createdById: event.userId, status: 'PUBLISHED', publishedAt: { not: null } },
      select: { id: true, title: true, publishedAt: true, createdById: true },
      orderBy: { publishedAt: 'desc' },
      take: BACKFILL_LIMIT,
    });
    for (const row of rows) await this.articles.syncCalendar(row, event.tenantSlug);
  }
}
