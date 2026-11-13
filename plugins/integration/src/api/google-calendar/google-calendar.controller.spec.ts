import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequest } from '@saas/backend';
import { GoogleCalendarController } from './google-calendar.controller';
import { calendarSettingsSchema } from './dto/connect.dto';

const req = { tenant: { slug: 'acme' }, user: { userId: 'u1' } } as unknown as AuthenticatedRequest;

function setup(links: Array<Record<string, any>> = [], meetings: { items?: Array<Record<string, any>>; spaces?: Array<Record<string, any>> } = {}) {
  const connections = {
    configured: true,
    myStatus: jest.fn(async () => ({ configured: true, enabled: true, connection: null })),
    startConnect: jest.fn(async () => ({ url: 'https://accounts.google.com/...' })),
    completeConnect: jest.fn(async () => ({ status: 'CONNECTED' })),
    disconnect: jest.fn(async () => undefined),
    featureSwitches: jest.fn(async () => ({ calendar: true, meet: false, meetDefaultAccess: 'TRUSTED' })),
    updateSettings: jest.fn(async () => undefined),
    listUsers: jest.fn(async () => []),
  };
  const items = meetings.items ?? [];
  const spaces = meetings.spaces ?? [];
  const tenantDb = {
    calendarEventLink: {
      findMany: jest.fn(async () => links.map((l) => ({ ...l }))),
      count: jest.fn(async () => links.length),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = links.find((l) => l.id === where.id);
        return row ? { ...row } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ ...links.find((l) => l.id === where.id), ...data })),
    },
    user: { findMany: jest.fn(async () => [{ id: 'u1', username: 'ann', name: 'Ann', email: 'ann@acme.test' }]) },
    meetingSpace: {
      findMany: jest.fn(async () => spaces.map((sp) => ({ ...sp, item: items.find((i) => i.id === sp.itemId) }))),
      count: jest.fn(async () => spaces.length),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = spaces.find((sp) => sp.id === where.id);
        return row ? { ...row, item: items.find((i) => i.id === row.itemId) } : null;
      }),
    },
  };
  const prisma = { getTenantClient: jest.fn(() => tenantDb) };
  const calendarSync = { resync: jest.fn(async () => 1) };
  const meet = { cancel: jest.fn(async () => ({ status: 'cancelled', locked: true })) };
  const controller = new GoogleCalendarController(connections as any, prisma as any, calendarSync as any, meet as any);
  return { controller, connections, tenantDb, calendarSync, meet };
}

const linkRow = (overrides: Record<string, any> = {}) => ({
  id: 'l1',
  userId: 'u1',
  source: 'sample-plugin',
  key: 'article:42',
  externalEventId: 'abc',
  desired: { title: 'Published: Hello', start: '2026-11-02T09:00:00.000Z', description: 'SECRET DRAFT BODY', url: 'https://app.test/a' },
  status: 'FAILED',
  attempts: 1,
  lastError: 'Saving the event: Invalid start time.',
  syncedAt: null,
  updatedAt: new Date('2026-10-23T00:00:00Z'),
  ...overrides,
});

describe('GoogleCalendarController', () => {
  it("routes call the service with the caller's tenant and user", async () => {
    const { controller, connections } = setup();

    await controller.me(req);
    expect(connections.myStatus).toHaveBeenCalledWith('acme', 'u1');

    await controller.connect(req);
    expect(connections.startConnect).toHaveBeenCalledWith('acme', 'u1');

    await controller.callback(req, { code: 'c', state: 's' });
    expect(connections.completeConnect).toHaveBeenCalledWith('acme', 'u1', 'c', 's');

    await controller.disconnect(req, { deleteCalendar: true });
    expect(connections.disconnect).toHaveBeenCalledWith('acme', 'u1', { deleteCalendar: true });

    await controller.users(req);
    expect(connections.listUsers).toHaveBeenCalledWith('acme');
  });

  it('retry of a FAILED row re-queues it; of a SYNCED row is 409', async () => {
    const failed = setup([linkRow()]);
    await expect(failed.controller.retry(req, 'l1')).resolves.toEqual({ status: 'PENDING' });
    expect(failed.tenantDb.calendarEventLink.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { status: 'PENDING', attempts: 0, lastError: null },
    });
    expect(failed.calendarSync.resync).toHaveBeenCalledWith('acme', 'u1');

    const synced = setup([linkRow({ status: 'SYNCED' })]);
    await expect(synced.controller.retry(req, 'l1')).rejects.toBeInstanceOf(ConflictException);
    expect(synced.calendarSync.resync).not.toHaveBeenCalled();

    await expect(setup().controller.retry(req, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sync-log rows contain no token and no description body', async () => {
    const { controller, tenantDb } = setup([linkRow(), linkRow({ id: 'l2', status: 'SYNCED', desired: null })]);

    const result = await controller.syncLog(req, { status: 'FAILED', page: 2, limit: 10 });

    expect(tenantDb.calendarEventLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'FAILED' }, skip: 10, take: 10 }));
    expect(result.meta).toEqual({ total: 2, page: 2, limit: 10, totalPages: 1 });
    expect(result.data[0]).toMatchObject({
      id: 'l1', status: 'FAILED', title: 'Published: Hello', start: '2026-11-02T09:00:00.000Z',
      user: { name: 'Ann', email: 'ann@acme.test' }, lastError: 'Saving the event: Invalid start time.',
    });
    expect(result.data[1]).toMatchObject({ id: 'l2', title: null, start: null });
    const json = JSON.stringify(result);
    expect(json).not.toContain('SECRET DRAFT BODY');
    expect(json).not.toContain('desired');
    expect(json).not.toContain('externalEventId');
  });

  describe('Meet', () => {
    const item = { id: 'item1', source: 'sample-plugin', key: 'article-review:42', title: 'Review: Hello', currentSpaceId: 'sp2' };
    const space = (overrides: Record<string, any> = {}) => ({
      id: 'sp2', itemId: 'item1', hostUserId: 'u1', hostAccountId: 'sub-ann', spaceName: 'spaces/x', joinUrl: 'https://meet.google.com/x',
      access: 'TRUSTED', status: 'ACTIVE', lockState: 'OPEN', lastError: null, createdAt: new Date('2026-10-27T00:00:00Z'), ...overrides,
    });

    it('settings round-trip', async () => {
      const { controller, connections } = setup();

      await expect(controller.settings(req)).resolves.toEqual({ configured: true, calendar: { enabled: true }, meet: { enabled: false, defaultAccess: 'TRUSTED' } });

      connections.featureSwitches.mockResolvedValueOnce({ calendar: true, meet: true, meetDefaultAccess: 'OPEN' });
      await expect(controller.updateSettings(req, { meetEnabled: true, meetDefaultAccess: 'OPEN' })).resolves.toEqual({
        configured: true, calendar: { enabled: true }, meet: { enabled: true, defaultAccess: 'OPEN' },
      });
      expect(connections.updateSettings).toHaveBeenCalledWith('acme', { meetEnabled: true, meetDefaultAccess: 'OPEN' });
    });

    it("meetings lists only this tenant's rows with host names and never a token", async () => {
      const { controller, tenantDb } = setup([], { items: [item], spaces: [space(), space({ id: 'sp1', status: 'CANCELLED', lockState: 'LOCKED' })] });

      const result = await controller.meetings(req, { status: undefined, page: 1, limit: 20 });

      expect(tenantDb.meetingSpace.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, skip: 0, take: 20 }));
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
      expect(result.data[0]).toEqual({
        id: 'sp2', title: 'Review: Hello', source: 'sample-plugin', key: 'article-review:42', host: { name: 'Ann', email: 'ann@acme.test' },
        joinUrl: 'https://meet.google.com/x', access: 'TRUSTED', status: 'ACTIVE', lockState: 'OPEN', lastError: null, current: true,
        createdAt: new Date('2026-10-27T00:00:00Z'),
      });
      expect(result.data[1]).toMatchObject({ id: 'sp1', current: false });
      expect(JSON.stringify(result)).not.toMatch(/token|refresh|hostAccountId|spaces\//);
    });

    it('cancel of a non-current space is 409; the current one is cancelled through the provider', async () => {
      const { controller, meet } = setup([], { items: [item], spaces: [space(), space({ id: 'sp1', status: 'CANCELLED' })] });

      await expect(controller.cancelMeeting(req, 'sp1')).rejects.toBeInstanceOf(ConflictException);
      await expect(controller.cancelMeeting(req, 'missing')).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.cancelMeeting(req, 'sp2')).resolves.toEqual({ status: 'cancelled', locked: true });
      expect(meet.cancel).toHaveBeenCalledWith({ tenantSlug: 'acme', source: 'sample-plugin', key: 'article-review:42' });
    });

    it('PATCH settings rejects an unknown access type and an empty body', () => {
      expect(calendarSettingsSchema.safeParse({ meetDefaultAccess: 'PUBLIC' }).success).toBe(false);
      expect(calendarSettingsSchema.safeParse({}).success).toBe(false);
      expect(calendarSettingsSchema.safeParse({ calendarEnabled: false }).success).toBe(true);
    });
  });
});
