import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SampleArticleMeetingsService } from './sample-article-meetings.service';
import { SampleArticlesService } from './sample-articles.service';

type Row = Record<string, any>;

function fakePrisma(initial: Row[]) {
  const rows: Row[] = initial.map((row) => ({ ...row }));
  const match = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([field, value]) =>
      value && typeof value === 'object' && 'in' in value ? value.in.includes(row[field]) : row[field] === value,
    );
  const sampleArticle = {
    rows,
    findUnique: jest.fn(async ({ where }: Row) => {
      const row = rows.find((r) => match(r, where));
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where }: Row = {}) => rows.filter((r) => match(r, where)).map((r) => ({ ...r }))),
    delete: jest.fn(async ({ where }: Row) => {
      const index = rows.findIndex((r) => match(r, where));
      if (index < 0) throw new Error('not found');
      return rows.splice(index, 1)[0];
    }),
    deleteMany: jest.fn(async ({ where }: Row) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
      return { count: before - rows.length };
    }),
  };
  const users: Row[] = [{ id: 'host-1', name: 'Hana', username: 'hana' }, { id: 'host-2', name: null, username: 'budi' }];
  const user = {
    findUnique: jest.fn(async ({ where }: Row) => {
      const row = users.find((u) => u.id === where.id);
      return row ? { name: row.name, username: row.username } : null;
    }),
  };
  return { getTenantClient: jest.fn(() => ({ sampleArticle, user })), sampleArticle };
}

const article = (id: string, overrides: Row = {}): Row => ({
  id, title: `Article ${id}`, slug: id, body: 'b', status: 'DRAFT', publishedAt: null, featured: false,
  createdById: 'author-1', updatedById: 'author-1', createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const activeMeeting = (overrides: Row = {}) => ({
  provider: 'google-meet', joinUrl: 'https://meet.google.com/abc-defg-hij', hostUserId: 'host-1', access: 'TRUSTED', status: 'ACTIVE', ...overrides,
});

function setup({ withMeetings = true }: { withMeetings?: boolean } = {}) {
  const prisma = fakePrisma([article('a1', { title: 'Hello' }), article('a2')]);
  const meetings = {
    create: jest.fn(async (_input: unknown): Promise<any> => ({ status: 'created', meeting: activeMeeting() })),
    get: jest.fn(async (_ref: unknown): Promise<any> => null),
    cancel: jest.fn(async (_ref: unknown): Promise<any> => ({ status: 'cancelled', locked: true })),
  };
  const calendar = {
    upsert: jest.fn(async (_input: unknown): Promise<any> => ({ status: 'queued' })),
    remove: jest.fn(async (_ref: unknown): Promise<any> => ({ status: 'queued' })),
    resync: jest.fn(),
  };
  const reviews = new SampleArticleMeetingsService(prisma as any, withMeetings ? (meetings as any) : undefined, calendar as any);
  const articles = new SampleArticlesService(prisma as any, calendar as any, reviews);
  for (const service of [reviews, articles]) jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { prisma, meetings, calendar, reviews, articles };
}

const meetingRef = (id: string) => ({ tenantSlug: 'acme', source: 'sample-plugin', key: `article-review:${id}` });

describe('Sample article review meetings', () => {
  it('create uses the article key and the current user as host', async () => {
    const { reviews, meetings } = setup();

    const result = await reviews.create('acme', 'a1', 'user-2', 'OPEN');

    expect(meetings.create).toHaveBeenCalledWith({ ...meetingRef('a1'), hostUserId: 'user-2', title: 'Review: Hello', access: 'OPEN' });
    expect(result).toEqual({ status: 'created', meeting: activeMeeting() });
    await expect(reviews.create('acme', 'missing', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
    expect(meetings.create).toHaveBeenCalledTimes(1);
  });

  it("get returns the meeting of an existing article and who hosts it", async () => {
    const { reviews, meetings } = setup();
    meetings.get.mockResolvedValueOnce(activeMeeting());

    await expect(reviews.get('acme', 'a1', 'host-1')).resolves.toEqual({ meeting: activeMeeting(), host: { name: 'Hana', isYou: true } });
    expect(meetings.get).toHaveBeenCalledWith(meetingRef('a1'));

    meetings.get.mockResolvedValueOnce(activeMeeting({ hostUserId: 'host-2' }));
    await expect(reviews.get('acme', 'a1', 'host-1')).resolves.toMatchObject({ host: { name: 'budi', isYou: false } });
    meetings.get.mockResolvedValueOnce(activeMeeting({ hostUserId: 'gone' }));
    await expect(reviews.get('acme', 'a1', 'host-1')).resolves.toMatchObject({ host: null });
    await expect(reviews.get('acme', 'a1', 'host-1')).resolves.toEqual({ meeting: null, host: null });
    await expect(reviews.get('acme', 'missing', 'host-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("schedule puts the review, with its meeting, on the host's calendar and is refused without an active meeting", async () => {
    const { reviews, meetings, calendar } = setup();
    const start = new Date('2026-11-02T03:00:00Z');
    meetings.get.mockResolvedValueOnce(activeMeeting());
    const oldFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.test/';

    try {
      await expect(reviews.schedule('acme', 'a1', 'host-1', start)).resolves.toEqual({ status: 'queued' });
    } finally {
      process.env.FRONTEND_URL = oldFrontendUrl;
    }
    // The join link is the event's meeting (Google: its Google Meet); url leads back to the article
    expect(calendar.upsert).toHaveBeenCalledWith({
      tenantSlug: 'acme', userId: 'host-1', source: 'sample-plugin', key: 'article-review:a1',
      title: 'Review: Hello', start, end: new Date('2026-11-02T03:30:00Z'),
      meetingUrl: 'https://meet.google.com/abc-defg-hij', url: 'https://app.test/plugins/sample-plugin/articles/a1',
    });

    meetings.get.mockResolvedValueOnce(activeMeeting({ status: 'ORPHANED' }));
    await expect(reviews.schedule('acme', 'a1', 'host-1', start)).rejects.toBeInstanceOf(ConflictException);
    meetings.get.mockResolvedValueOnce(null);
    await expect(reviews.schedule('acme', 'a1', 'host-1', start)).rejects.toBeInstanceOf(ConflictException);
    expect(calendar.upsert).toHaveBeenCalledTimes(1);
  });

  it("schedule puts the review only on the host's own calendar: anyone else is refused", async () => {
    const { reviews, meetings, calendar } = setup();
    meetings.get.mockResolvedValue(activeMeeting());

    await expect(reviews.schedule('acme', 'a1', 'user-2', new Date('2026-11-02T03:00:00Z'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(calendar.upsert).not.toHaveBeenCalled();
  });

  it('a bulk delete releases its meetings together, not one after another', async () => {
    const { articles, meetings } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    meetings.get.mockImplementation(async () => {
      await gate;
      return activeMeeting();
    });

    const deleting = articles.bulkDelete(['a1', 'a2'], 'acme');
    await new Promise((resolve) => setImmediate(resolve));
    expect(meetings.get).toHaveBeenCalledTimes(2);
    release();
    await deleting;

    expect(meetings.cancel.mock.calls).toEqual([[meetingRef('a1')], [meetingRef('a2')]]);
  });

  it("cancel cancels the meeting and removes the host's calendar event", async () => {
    const { reviews, meetings, calendar } = setup();
    meetings.get.mockResolvedValueOnce(activeMeeting());

    await expect(reviews.cancel('acme', 'a1')).resolves.toEqual({ status: 'cancelled', locked: true });
    expect(meetings.cancel).toHaveBeenCalledWith(meetingRef('a1'));
    expect(calendar.remove).toHaveBeenCalledWith({ tenantSlug: 'acme', userId: 'host-1', source: 'sample-plugin', key: 'article-review:a1' });
  });

  it('deleting an article cancels its meeting and removes its calendar event', async () => {
    const { articles, meetings, calendar, prisma } = setup();
    meetings.get.mockImplementation(async (ref: any) => (ref.key === 'article-review:a2' ? null : activeMeeting()));

    await articles.remove('a1', 'acme');
    expect(meetings.cancel).toHaveBeenCalledWith(meetingRef('a1'));
    expect(calendar.remove).toHaveBeenCalledWith({ tenantSlug: 'acme', userId: 'host-1', source: 'sample-plugin', key: 'article-review:a1' });

    prisma.sampleArticle.rows.push(article('a3'));
    meetings.cancel.mockClear();
    await articles.bulkDelete(['a2', 'a3'], 'acme');
    // a2 has no meeting: nothing to cancel
    expect(meetings.cancel.mock.calls).toEqual([[meetingRef('a3')]]);
    expect(prisma.sampleArticle.rows).toEqual([]);
  });

  it("meeting or calendar failures don't fail the article action", async () => {
    const { articles, meetings, calendar, prisma } = setup();
    meetings.get.mockResolvedValue(activeMeeting());
    meetings.cancel.mockRejectedValue(new Error('Google is down'));
    calendar.remove.mockRejectedValue(new Error('queue is down'));

    await expect(articles.remove('a1', 'acme')).resolves.toBeUndefined();
    meetings.get.mockRejectedValue(new Error('database hiccup'));
    await expect(articles.bulkDelete(['a2'], 'acme')).resolves.toBeUndefined();
    expect(prisma.sampleArticle.rows).toEqual([]);
  });

  it('works without MEETINGS', async () => {
    const { reviews, articles, calendar, prisma } = setup({ withMeetings: false });

    await expect(reviews.get('acme', 'a1', 'user-2')).resolves.toEqual({ meeting: null, host: null });
    await expect(reviews.create('acme', 'a1', 'user-2')).resolves.toEqual({ status: 'not-configured' });
    await expect(reviews.cancel('acme', 'a1')).resolves.toEqual({ status: 'not-found', locked: false });
    await expect(reviews.schedule('acme', 'a1', 'user-2', new Date())).rejects.toBeInstanceOf(ConflictException);
    await expect(articles.remove('a1', 'acme')).resolves.toBeUndefined();
    expect(calendar.upsert).not.toHaveBeenCalled();
    expect(prisma.sampleArticle.rows.map((row) => row.id)).toEqual(['a2']);
  });
});
