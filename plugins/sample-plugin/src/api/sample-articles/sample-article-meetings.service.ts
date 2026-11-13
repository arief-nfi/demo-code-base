// plugins/sample-plugin/src/api/sample-articles/sample-article-meetings.service.ts
import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  CALENDAR_SYNC, MEETINGS, PrismaService,
  type CalendarRef, type CalendarSyncStatus, type ICalendarSync, type IMeetingService,
  type MeetingAccess, type MeetingCancelResult, type MeetingInfo, type MeetingRef, type MeetingResult,
} from '@saas/backend';
import { articleUrl } from './article-url';

const REVIEW_MINUTES = 30;

/** Who hosts the meeting, as the article page shows it */
export interface ReviewMeetingHost {
  name: string;
  isYou: boolean;
}

/**
 * An article's review meeting (e.g. Google Meet), hosted by whoever creates it, and its slot on
 * the host's calendar. Both services come from core; optional so the plugin also runs without them.
 */
@Injectable()
export class SampleArticleMeetingsService {
  private readonly logger = new Logger(SampleArticleMeetingsService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(MEETINGS) private meetings?: IMeetingService,
    @Optional() @Inject(CALENDAR_SYNC) private calendar?: ICalendarSync,
  ) {}

  private ref(tenantSlug: string, articleId: string): MeetingRef {
    return { tenantSlug, source: 'sample-plugin', key: `article-review:${articleId}` };
  }

  private calendarRef(tenantSlug: string, articleId: string, hostUserId: string): CalendarRef {
    return { ...this.ref(tenantSlug, articleId), userId: hostUserId };
  }

  private async article(tenantSlug: string, id: string): Promise<{ id: string; title: string }> {
    const article = await this.prisma.getTenantClient(tenantSlug).sampleArticle.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!article) throw new NotFoundException(`Sample article with ID ${id} not found`);
    return article;
  }

  async get(tenantSlug: string, articleId: string, viewerUserId: string): Promise<{ meeting: MeetingInfo | null; host: ReviewMeetingHost | null }> {
    await this.article(tenantSlug, articleId);
    const meeting = this.meetings ? await this.meetings.get(this.ref(tenantSlug, articleId)) : null;
    if (!meeting) return { meeting: null, host: null };
    const user = await this.prisma
      .getTenantClient(tenantSlug)
      .user.findUnique({ where: { id: meeting.hostUserId }, select: { name: true, username: true } });
    return { meeting, host: user ? { name: user.name ?? user.username, isYou: meeting.hostUserId === viewerUserId } : null };
  }

  async create(tenantSlug: string, articleId: string, hostUserId: string, access?: MeetingAccess): Promise<MeetingResult> {
    const article = await this.article(tenantSlug, articleId);
    if (!this.meetings) return { status: 'not-configured' };
    return this.meetings.create({ ...this.ref(tenantSlug, articleId), hostUserId, title: `Review: ${article.title}`, access });
  }

  async cancel(tenantSlug: string, articleId: string): Promise<MeetingCancelResult> {
    await this.article(tenantSlug, articleId);
    return this.cancelMeeting(tenantSlug, articleId);
  }

  /** Puts the review on the host's own calendar, with its meeting, for REVIEW_MINUTES from `start` */
  async schedule(tenantSlug: string, articleId: string, userId: string, start: Date): Promise<{ status: CalendarSyncStatus }> {
    const article = await this.article(tenantSlug, articleId);
    const meeting = this.meetings ? await this.meetings.get(this.ref(tenantSlug, articleId)) : null;
    if (meeting?.status !== 'ACTIVE') throw new ConflictException('Create the review meeting first');
    // Nobody writes to someone else's Google Calendar
    if (meeting.hostUserId !== userId) throw new ForbiddenException('Only the host can add the review to their calendar');
    if (!this.calendar) return { status: 'not-configured' };
    return this.calendar.upsert({
      ...this.calendarRef(tenantSlug, articleId, meeting.hostUserId),
      title: `Review: ${article.title}`,
      start,
      end: new Date(start.getTime() + REVIEW_MINUTES * 60_000),
      meetingUrl: meeting.joinUrl,
      url: articleUrl(articleId),
    });
  }

  /** For deleted articles: cancels their meetings and calendar slots, all at once. Never throws */
  async release(tenantSlug: string, articleIds: string[]): Promise<void> {
    await Promise.all(
      articleIds.map((articleId) =>
        this.cancelMeeting(tenantSlug, articleId).catch((error) =>
          this.logger.warn(`Cancelling the review meeting of article ${articleId} failed: ${error instanceof Error ? error.message : String(error)}`),
        ),
      ),
    );
  }

  private async cancelMeeting(tenantSlug: string, articleId: string): Promise<MeetingCancelResult> {
    const meeting = this.meetings ? await this.meetings.get(this.ref(tenantSlug, articleId)) : null;
    if (!this.meetings || !meeting) return { status: 'not-found', locked: false };
    try {
      return await this.meetings.cancel(this.ref(tenantSlug, articleId));
    } finally {
      // The calendar slot goes even when Google can't be reached for the meeting
      await this.calendar
        ?.remove(this.calendarRef(tenantSlug, articleId, meeting.hostUserId))
        .catch((error) => this.logger.warn(`Removing the review of article ${articleId} from the calendar failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}
