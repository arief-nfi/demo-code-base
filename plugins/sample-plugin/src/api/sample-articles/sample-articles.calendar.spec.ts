import { SampleArticlesService } from './sample-articles.service';
import { SampleArticlesCalendarListener } from './sample-articles.calendar-listener';

type Row = Record<string, any>;

function fakePrisma(initial: Row[] = []) {
  const rows: Row[] = initial.map((row) => ({ ...row }));
  let seq = 0;
  const match = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([field, value]) => {
      if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[field]);
      if (value && typeof value === 'object' && 'not' in value) return row[field] !== value.not;
      return row[field] === value;
    });
  const sampleArticle = {
    rows,
    count: jest.fn(async ({ where }: Row) => rows.filter((r) => match(r, where)).length),
    findUnique: jest.fn(async ({ where }: Row) => {
      const row = rows.find((r) => match(r, where));
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where, take }: Row = {}) => {
      const hit = rows.filter((r) => match(r, where)).sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
      return hit.slice(0, take ?? hit.length).map((r) => ({ ...r }));
    }),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: `a${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = rows.find((r) => match(r, where));
      if (!row) throw new Error('not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    }),
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
  const client = {
    sampleArticle,
    user: { findMany: jest.fn(async () => []) },
    plugin: { findUnique: jest.fn(async () => ({ key: 'sample-plugin', isEnabled: true })) },
  };
  return { prisma: { getTenantClient: jest.fn(() => client) }, client };
}

function setup(initial: Row[] = []) {
  const { prisma, client } = fakePrisma(initial);
  const calendar = {
    upsert: jest.fn(async (_input: unknown) => ({ status: 'queued' })),
    remove: jest.fn(async (_ref: unknown) => ({ status: 'queued' })),
    resync: jest.fn(),
  };
  const reviewMeetings = { release: jest.fn(async () => undefined) };
  const service = new SampleArticlesService(prisma as any, calendar as any, reviewMeetings as any);
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, calendar, client, prisma };
}

const article = (overrides: Row = {}): Row => ({
  id: 'a1', title: 'Hello', slug: 'hello', body: 'b', status: 'DRAFT', publishedAt: null, featured: false,
  createdById: 'author-1', updatedById: 'author-1', createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const ref = (id: string, userId = 'author-1') => ({ tenantSlug: 'acme', userId, source: 'sample-plugin', key: `article:${id}` });

describe('Sample articles on the author\'s calendar', () => {
  const OLD_FRONTEND_URL = process.env.FRONTEND_URL;
  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://app.test/';
  });
  afterAll(() => {
    process.env.FRONTEND_URL = OLD_FRONTEND_URL;
  });

  it("publishing an article upserts it on the author's calendar", async () => {
    const { service, calendar } = setup();

    const created = await service.create({ title: 'Hello', slug: 'hello', body: 'b', status: 'PUBLISHED' } as any, 'author-1', 'acme');

    expect(calendar.upsert).toHaveBeenCalledWith({
      ...ref(created.id),
      title: 'Published: Hello',
      start: new Date(created.publishedAt as string),
      url: `https://app.test/plugins/sample-plugin/articles/${created.id}`,
    });
  });

  it('a draft is not put on the calendar', async () => {
    const { service, calendar } = setup();

    await service.create({ title: 'Draft', slug: 'draft', body: 'b' } as any, 'author-1', 'acme');

    expect(calendar.upsert).not.toHaveBeenCalled();
    expect(calendar.remove).not.toHaveBeenCalled();
  });

  it('unpublishing removes it', async () => {
    const { service, calendar } = setup([article({ status: 'PUBLISHED', publishedAt: new Date('2026-10-20T10:00:00Z') })]);

    await service.update('a1', { status: 'DRAFT' } as any, 'editor-2', 'acme');

    expect(calendar.remove).toHaveBeenCalledWith(ref('a1'));
    expect(calendar.upsert).not.toHaveBeenCalled();
  });

  it('editing a published article upserts again (same key), on the author\'s calendar not the editor\'s', async () => {
    const publishedAt = new Date('2026-10-20T10:00:00Z');
    const { service, calendar } = setup([article({ status: 'PUBLISHED', publishedAt })]);

    await service.update('a1', { title: 'Hello again' } as any, 'editor-2', 'acme');

    expect(calendar.upsert).toHaveBeenCalledWith(expect.objectContaining({ ...ref('a1'), title: 'Published: Hello again', start: publishedAt }));
  });

  it('editing a draft touches nothing', async () => {
    const { service, calendar } = setup([article()]);

    await service.update('a1', { title: 'Still a draft' } as any, 'author-1', 'acme');

    expect(calendar.upsert).not.toHaveBeenCalled();
    expect(calendar.remove).not.toHaveBeenCalled();
  });

  it('deleting and bulk deleting remove each published article', async () => {
    const published = { status: 'PUBLISHED', publishedAt: new Date('2026-10-20T10:00:00Z') };
    const { service, calendar } = setup([
      article({ id: 'a1', ...published }),
      article({ id: 'a2', ...published, createdById: 'author-2' }),
      article({ id: 'a3' }),
      article({ id: 'a4', ...published }),
    ]);

    await service.remove('a1', 'acme');
    await service.bulkDelete(['a2', 'a3', 'a4'], 'acme');

    expect(calendar.remove.mock.calls.map(([r]) => r)).toEqual([ref('a1'), ref('a2', 'author-2'), ref('a4')]);
  });

  it('a calendar failure does not fail the article action', async () => {
    const { service, calendar, client } = setup();
    calendar.upsert.mockRejectedValueOnce(new Error('Redis down'));

    await expect(service.create({ title: 'Hello', slug: 'hello', body: 'b', status: 'PUBLISHED' } as any, 'author-1', 'acme')).resolves.toMatchObject({ title: 'Hello' });
    expect(client.sampleArticle.rows).toHaveLength(1);
  });

  it('works without a calendar (CALENDAR_SYNC not provided)', async () => {
    const { prisma } = fakePrisma();
    const service = new SampleArticlesService(prisma as any, undefined, { release: jest.fn() } as any);

    await expect(service.create({ title: 'Hello', slug: 'hello', body: 'b', status: 'PUBLISHED' } as any, 'author-1', 'acme')).resolves.toBeDefined();
  });

  it("on connect, the author's published articles are upserted (max 100)", async () => {
    const rows = Array.from({ length: 105 }, (_, i) =>
      article({ id: `p${i}`, slug: `p${i}`, status: 'PUBLISHED', publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) }),
    );
    rows.push(article({ id: 'draft', slug: 'draft' }), article({ id: 'other', slug: 'other', status: 'PUBLISHED', publishedAt: new Date(), createdById: 'author-2' }));
    const { service, calendar, prisma } = setup(rows);
    const listener = new SampleArticlesCalendarListener(prisma as any, null as any, service);

    await listener.onCalendarConnected({ tenantSlug: 'acme', userId: 'author-1', timestamp: new Date() });

    expect(calendar.upsert).toHaveBeenCalledTimes(100);
    const keys = calendar.upsert.mock.calls.map(([input]) => (input as { key: string }).key);
    expect(keys).toContain('article:p104'); // the most recent ones
    expect(keys).not.toContain('article:p0');
    expect(keys).not.toContain('article:draft');
    expect(keys).not.toContain('article:other');
  });
});
