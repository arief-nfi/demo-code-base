// plugins/sample-plugin/src/api/sample-articles/sample-articles.service.ts
import { Injectable, NotFoundException, ConflictException, Inject, Logger, Optional } from '@nestjs/common';
import { CALENDAR_SYNC, PrismaService, type ICalendarSync } from '@saas/backend';
import type { CreateSampleArticleDto } from './dto/create-sample-article.dto';
import type { UpdateSampleArticleDto } from './dto/update-sample-article.dto';
import type { SampleArticleQueryDto } from './dto/sample-article-query.dto';
import { SampleArticleMeetingsService } from './sample-article-meetings.service';
import { articleUrl } from './article-url';

export type SampleArticleStatus = 'DRAFT' | 'PUBLISHED';

export interface UserRef {
  id: string;
  name: string | null;
  username: string;
}

export interface SampleArticle {
  id: string;
  title: string;
  slug: string;
  body: string;
  status: SampleArticleStatus;
  publishedAt: string | null;
  featured: boolean;
  createdById: string | null;
  updatedById: string | null;
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
}

/** The fields an article's calendar event is made from */
interface CalendarArticle {
  id: string;
  title: string;
  publishedAt: Date | null;
  createdById: string | null;
}

@Injectable()
export class SampleArticlesService {
  private readonly logger = new Logger(SampleArticlesService.name);

  constructor(
    private prisma: PrismaService,
    // Core provides it globally; optional so the plugin also runs where it doesn't
    @Optional() @Inject(CALENDAR_SYNC) private calendar: ICalendarSync | undefined,
    private reviewMeetings: SampleArticleMeetingsService,
  ) {}

  /**
   * Puts a published article on its author's calendar at the moment it was published,
   * or takes it off when it no longer is. Calendar trouble never fails the article action.
   */
  async syncCalendar(article: CalendarArticle, tenantSlug: string, wasPublished = false): Promise<void> {
    if (!this.calendar || !article.createdById) return;
    const ref = { tenantSlug, userId: article.createdById, source: 'sample-plugin', key: `article:${article.id}` };
    try {
      if (article.publishedAt) {
        await this.calendar.upsert({
          ...ref,
          title: `Published: ${article.title}`,
          start: article.publishedAt,
          url: articleUrl(article.id),
        });
      } else if (wasPublished) {
        await this.calendar.remove(ref);
      }
    } catch (error) {
      this.logger.warn(`Calendar sync of article ${article.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  private toDto(
    row: {
      id: string;
      title: string;
      slug: string;
      body: string;
      status: SampleArticleStatus;
      publishedAt: Date | null;
      featured: boolean;
      createdById: string | null;
      updatedById: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    userMap: Map<string, UserRef>,
  ): SampleArticle {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      body: row.body,
      status: row.status,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      featured: row.featured,
      createdById: row.createdById,
      updatedById: row.updatedById,
      createdBy: row.createdById ? userMap.get(row.createdById) ?? null : null,
      updatedBy: row.updatedById ? userMap.get(row.updatedById) ?? null : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Cross-fragment lookup: User lives in header.prisma, not this plugin's fragment,
   * so we resolve via a separate batched findMany — never `include`.
   * See: docs/superpowers/specs/cross-fragment-references.
   */
  private async fetchUsers(
    client: ReturnType<PrismaService['getTenantClient']>,
    ids: ReadonlyArray<string | null | undefined>,
  ): Promise<Map<string, UserRef>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
    if (unique.length === 0) return new Map();
    const users = await client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, username: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  async findAll(tenantSlug: string, params: SampleArticleQueryDto) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc', status } = params;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' as const } },
        { slug: { contains: search, mode: 'insensitive' as const } },
        { body: { contains: search, mode: 'insensitive' as const } },
      ];
    }
    if (status) {
      where.status = status;
    }

    const [rows, total] = await Promise.all([
      client.sampleArticle.findMany({
        where: where as any,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
      }),
      client.sampleArticle.count({ where: where as any }),
    ]);

    const userMap = await this.fetchUsers(
      client,
      rows.flatMap((r) => [r.createdById, r.updatedById]),
    );

    return {
      data: rows.map((r) => this.toDto(r as any, userMap)),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: string, tenantSlug: string): Promise<SampleArticle> {
    const client = this.getClient(tenantSlug);
    const row = await client.sampleArticle.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Sample article with ID ${id} not found`);
    }
    const userMap = await this.fetchUsers(client, [row.createdById, row.updatedById]);
    return this.toDto(row as any, userMap);
  }

  async checkSlugAvailable(slug: string, excludeId: string | undefined, tenantSlug: string): Promise<boolean> {
    const client = this.getClient(tenantSlug);
    const where: Record<string, unknown> = { slug };
    if (excludeId) where.id = { not: excludeId };
    const count = await client.sampleArticle.count({ where: where as any });
    return count === 0;
  }

  async create(dto: CreateSampleArticleDto, userId: string, tenantSlug: string): Promise<SampleArticle> {
    const client = this.getClient(tenantSlug);

    const available = await this.checkSlugAvailable(dto.slug, undefined, tenantSlug);
    if (!available) {
      throw new ConflictException(`Sample article with slug '${dto.slug}' already exists`);
    }

    const nextStatus: SampleArticleStatus = dto.status ?? 'DRAFT';
    const publishedAt = nextStatus === 'PUBLISHED' ? new Date() : null;

    const row = await client.sampleArticle.create({
      data: {
        title:       dto.title,
        slug:        dto.slug,
        body:        dto.body,
        status:      nextStatus,
        featured:    dto.featured ?? false,
        publishedAt,
        createdById: userId,
        updatedById: userId,
      },
    });
    await this.syncCalendar(row, tenantSlug);
    const userMap = await this.fetchUsers(client, [row.createdById, row.updatedById]);
    return this.toDto(row as any, userMap);
  }

  async update(id: string, dto: UpdateSampleArticleDto, userId: string, tenantSlug: string): Promise<SampleArticle> {
    const client = this.getClient(tenantSlug);

    const existing = await client.sampleArticle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Sample article with ID ${id} not found`);
    }

    if (dto.slug && dto.slug !== existing.slug) {
      const available = await this.checkSlugAvailable(dto.slug, id, tenantSlug);
      if (!available) {
        throw new ConflictException(`Sample article with slug '${dto.slug}' already exists`);
      }
    }

    // Status transition rules:
    //   DRAFT      → PUBLISHED: stamp publishedAt = now()
    //   PUBLISHED  → DRAFT:     clear publishedAt
    //   else:                    leave publishedAt untouched
    const data: Record<string, unknown> = { ...dto, updatedById: userId };
    if (dto.status && dto.status !== existing.status) {
      if (dto.status === 'PUBLISHED') {
        data.publishedAt = new Date();
      } else if (dto.status === 'DRAFT') {
        data.publishedAt = null;
      }
    }

    let row;
    try {
      row = await client.sampleArticle.update({ where: { id }, data: data as any });
    } catch {
      throw new NotFoundException(`Sample article with ID ${id} not found`);
    }
    await this.syncCalendar(row, tenantSlug, !!existing.publishedAt);
    const userMap = await this.fetchUsers(client, [row.createdById, row.updatedById]);
    return this.toDto(row as any, userMap);
  }

  async remove(id: string, tenantSlug: string): Promise<void> {
    const client = this.getClient(tenantSlug);
    let row;
    try {
      row = await client.sampleArticle.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Sample article with ID ${id} not found`);
    }
    await this.syncCalendar({ ...row, publishedAt: null }, tenantSlug, !!row.publishedAt);
    await this.reviewMeetings.release(tenantSlug, [row.id]);
  }

  async bulkDelete(ids: string[], tenantSlug: string): Promise<void> {
    const client = this.getClient(tenantSlug);
    // Read first: the authors' calendars need to know which ones were published
    const rows = await client.sampleArticle.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, publishedAt: true, createdById: true },
    });
    await client.sampleArticle.deleteMany({ where: { id: { in: ids } } });
    for (const row of rows) {
      await this.syncCalendar({ ...row, publishedAt: null }, tenantSlug, !!row.publishedAt);
    }
    await this.reviewMeetings.release(tenantSlug, rows.map((row) => row.id));
  }
}
