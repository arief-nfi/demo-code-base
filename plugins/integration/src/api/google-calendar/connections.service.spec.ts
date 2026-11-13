import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { createSecretBox, SystemEvents } from '@saas/backend';
import { ConnectionsService } from './connections.service';
import { GoogleApiError } from './google-api';
import type { GoogleCalendarConfig } from './google-calendar.config';

const KEY = Buffer.alloc(32, 9).toString('base64');
const box = createSecretBox(KEY);
const REFRESH = '1//refresh-token-of-ann';
const ACCESS = 'ya29.access-token-of-ann';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
const BOTH = { googleCalendar: { enabled: true }, googleMeet: { enabled: true, defaultAccess: 'TRUSTED' } };
const MEET_ONLY = { googleCalendar: { enabled: false }, googleMeet: { enabled: true, defaultAccess: 'TRUSTED' } };

const config: GoogleCalendarConfig = {
  clientId: 'cid',
  clientSecret: 'csecret',
  encryptionKey: KEY,
  redirectUri: 'https://app.test/plugins/integration/google-calendar/callback',
  appName: 'Acme Cloud',
  configured: true,
};

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === 'NOT') return !matches(row, condition);
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[field]);
      return matches(row, condition); // compound unique, e.g. tenantSlug_userId
    }
    return row[field] === condition;
  });
}

/** An in-memory Prisma model; like Prisma, it returns copies, never the stored rows */
function fakeModel(initial: Row[] = []) {
  const rows = initial.map((row) => ({ ...row }));
  let seq = 0;
  const copy = (row: Row | undefined) => (row ? { ...row } : null);
  return {
    rows,
    findUnique: jest.fn(async ({ where }: Row) => copy(rows.find((r) => matches(r, where)))),
    findFirst: jest.fn(async ({ where }: Row = {}) => copy(rows.find((r) => matches(r, where)))),
    findMany: jest.fn(async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r }))),
    count: jest.fn(async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: `id-${++seq}`, ...data };
      rows.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
    upsert: jest.fn(async ({ where, create, update }: Row) => {
      const row = rows.find((r) => matches(r, where));
      if (row) return { ...Object.assign(row, update) };
      const created = { id: `id-${++seq}`, ...create };
      rows.push(created);
      return { ...created };
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where }: Row = {}) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: before - rows.length };
    }),
  };
}

function connectionRow(overrides: Row = {}): Row {
  return {
    id: 'conn-1',
    userId: 'u1',
    provider: 'google',
    externalAccountId: 'sub-ann',
    accountEmail: 'ann@gmail.test',
    refreshTokenEnc: box.seal(REFRESH, `google-calendar:acme:${overrides.userId ?? 'u1'}`),
    scopes: `openid email ${CALENDAR_SCOPE}`,
    calendarId: 'cal-old',
    calendarName: 'Acme Corp (via Acme Cloud)',
    status: 'CONNECTED',
    lastError: null,
    connectedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(opts: { connections?: Row[]; links?: Row[]; index?: Row[]; pluginConfig?: unknown; spaces?: Row[] } = {}) {
  const tenantDb = {
    calendarConnection: fakeModel(opts.connections),
    calendarEventLink: fakeModel(opts.links),
    meetingSpace: fakeModel(opts.spaces),
    plugin: fakeModel([{ id: 'p1', key: 'integration', isEnabled: true, config: opts.pluginConfig ?? { googleCalendar: { enabled: true } } }]),
    tenantConfig: fakeModel([{ id: 'tc', timezone: 'Asia/Jakarta' }]),
    user: fakeModel([
      { id: 'u1', username: 'ann', name: 'Ann', email: 'ann@acme.test' },
      { id: 'u2', username: 'bob', name: null, email: 'bob@acme.test' },
    ]),
  };
  const prisma = {
    tenant: fakeModel([{ id: 't1', slug: 'acme', name: 'Acme Corp' }]),
    calendarAccountIndex: fakeModel(opts.index),
    getTenantClient: jest.fn(() => tenantDb),
  };
  const store = new Map<string, unknown>();
  const cache = {
    store,
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => void store.set(key, value)),
    del: jest.fn(async (key: string) => void store.delete(key)),
    take: jest.fn(async (key: string) => {
      const value = store.has(key) ? store.get(key) : null;
      store.delete(key);
      return value;
    }),
  };
  const events = { emit: jest.fn() };
  const google = {
    authUrl: jest.fn((state: string, challenge: string, _scopes: string[]) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&code_challenge=${challenge}`),
    exchangeCode: jest.fn(async () => ({
      refreshToken: REFRESH as string | null,
      accessToken: ACCESS,
      expiresAt: Date.now() + 3_600_000,
      sub: 'sub-ann',
      email: 'ann@gmail.test',
      scopes: `openid ${CALENDAR_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    })),
    refreshAccessToken: jest.fn(async () => ({ accessToken: ACCESS, expiresAt: Date.now() + 3_600_000 })),
    revoke: jest.fn(async () => undefined),
    createCalendar: jest.fn(async () => 'cal-new'),
    calendarExists: jest.fn(async () => true),
    deleteCalendar: jest.fn(async () => undefined),
    putEvent: jest.fn(),
    deleteEvent: jest.fn(),
  };
  const calendarSync = { upsert: jest.fn(), remove: jest.fn(), resync: jest.fn(async () => 0) };
  const meetSpaces = { lockHostSpaces: jest.fn(async () => undefined), retryPending: jest.fn(async () => 0) };
  const service = new ConnectionsService(prisma as any, cache as any, events as any, google as any, config, calendarSync as any, meetSpaces as any);
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, tenantDb, prisma, cache, events, google, calendarSync, meetSpaces };
}

type Ctx = ReturnType<typeof setup>;

async function startState(ctx: Ctx, userId = 'u1'): Promise<string> {
  const { url } = await ctx.service.startConnect('acme', userId);
  return new URL(url).searchParams.get('state') as string;
}

async function connect(ctx: Ctx, userId = 'u1') {
  return ctx.service.completeConnect('acme', userId, 'code-1', await startState(ctx, userId));
}

describe('ConnectionsService', () => {
  describe('connecting', () => {
    it("startConnect returns Google's URL and stores the state for this user and tenant", async () => {
      const ctx = setup();

      const { url } = await ctx.service.startConnect('acme', 'u1');

      const [state, challenge] = ctx.google.authUrl.mock.calls[0];
      expect(url).toContain(`state=${state}`);
      const stored = ctx.cache.store.get(`gcal:state:${state}`) as { tenantSlug: string; userId: string; verifier: string };
      expect(stored).toMatchObject({ tenantSlug: 'acme', userId: 'u1' });
      expect(challenge).toBe(createHash('sha256').update(stored.verifier).digest('base64url'));
      expect(stored.verifier.length).toBeGreaterThanOrEqual(43);
    });

    it('startConnect is refused while the tenant has Google Calendar switched off', async () => {
      const ctx = setup({ pluginConfig: { googleCalendar: { enabled: false } } });

      await expect(ctx.service.startConnect('acme', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('completeConnect stores an encrypted refresh token, creates the calendar, writes the index, emits CONNECTED and resyncs', async () => {
      const ctx = setup();
      const state = await startState(ctx);
      const verifier = (ctx.cache.store.get(`gcal:state:${state}`) as { verifier: string }).verifier;

      const view = await ctx.service.completeConnect('acme', 'u1', 'code-1', state);

      expect(ctx.google.exchangeCode).toHaveBeenCalledWith('code-1', verifier);
      expect(ctx.google.createCalendar).toHaveBeenCalledWith(ACCESS, 'Acme Corp (via Acme Cloud)', 'Asia/Jakarta');
      const [row] = ctx.tenantDb.calendarConnection.rows;
      expect(row).toMatchObject({ userId: 'u1', externalAccountId: 'sub-ann', accountEmail: 'ann@gmail.test', calendarId: 'cal-new', status: 'CONNECTED' });
      expect(row.refreshTokenEnc).not.toContain(REFRESH);
      expect(box.open(row.refreshTokenEnc, 'google-calendar:acme:u1')).toBe(REFRESH);
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([expect.objectContaining({ externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' })]);
      expect(ctx.events.emit).toHaveBeenCalledWith(SystemEvents.INTEGRATION_CALENDAR_CONNECTED, expect.objectContaining({ tenantSlug: 'acme', userId: 'u1' }));
      expect(ctx.calendarSync.resync).toHaveBeenCalledWith('acme', 'u1');
      expect(view).toMatchObject({ status: 'CONNECTED', accountEmail: 'ann@gmail.test', calendarName: 'Acme Corp (via Acme Cloud)' });
    });

    it('the account index is written before the connection, so a failed write never hides a shared grant', async () => {
      const ctx = setup();

      await connect(ctx);

      expect(ctx.prisma.calendarAccountIndex.upsert.mock.invocationCallOrder[0]).toBeLessThan(
        ctx.tenantDb.calendarConnection.upsert.mock.invocationCallOrder[0],
      );
    });

    it('a state from another user, another tenant, or a second use is refused', async () => {
      const expired = 'This connect link has expired. Start again.';
      const ctx = setup();

      await expect(ctx.service.completeConnect('acme', 'u2', 'code-1', await startState(ctx, 'u1'))).rejects.toThrow(expired);
      await expect(ctx.service.completeConnect('beta', 'u1', 'code-1', await startState(ctx, 'u1'))).rejects.toThrow(expired);

      const state = await startState(ctx, 'u1');
      await ctx.service.completeConnect('acme', 'u1', 'code-1', state);
      await expect(ctx.service.completeConnect('acme', 'u1', 'code-1', state)).rejects.toThrow(expired);
      await expect(ctx.service.completeConnect('acme', 'u1', 'code-1', 'made-up')).rejects.toThrow(expired);
      expect(ctx.google.exchangeCode).toHaveBeenCalledTimes(1);
    });

    it('two callbacks with the same state at once: only one exchanges the code', async () => {
      const ctx = setup();
      const state = await startState(ctx);

      const results = await Promise.allSettled([
        ctx.service.completeConnect('acme', 'u1', 'code-1', state),
        ctx.service.completeConnect('acme', 'u1', 'code-1', state),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(ctx.google.exchangeCode).toHaveBeenCalledTimes(1);
    });

    it("a refresh token copied to another user's row can't be used", async () => {
      const ctx = setup({ connections: [connectionRow({ userId: 'u2', refreshTokenEnc: box.seal(REFRESH, 'google-calendar:acme:u1') })] });

      await expect(ctx.service.accessToken('acme', 'u2')).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });
      expect(ctx.google.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('no refresh token from Google is refused with a clear message', async () => {
      const ctx = setup();
      ctx.google.exchangeCode.mockResolvedValueOnce({ ...(await ctx.google.exchangeCode()), refreshToken: null });

      await expect(connect(ctx)).rejects.toThrow(/offline access/);
      expect(ctx.tenantDb.calendarConnection.rows).toHaveLength(0);
    });

    it('a consent without the calendar permission is refused with a clear message', async () => {
      const ctx = setup();
      ctx.google.exchangeCode.mockResolvedValueOnce({ ...(await ctx.google.exchangeCode()), scopes: 'openid https://www.googleapis.com/auth/userinfo.email' });

      await expect(connect(ctx)).rejects.toThrow(/calendar/i);
      expect(ctx.google.createCalendar).not.toHaveBeenCalled();
      expect(ctx.tenantDb.calendarConnection.rows).toHaveLength(0);
    });

    it('reconnecting the same Google account reuses its calendar; a different account revokes the old one (if unshared) and creates a new calendar', async () => {
      const same = setup({ connections: [connectionRow({ status: 'NEEDS_RECONNECT' })] });
      await connect(same);
      expect(same.google.calendarExists).toHaveBeenCalledWith(ACCESS, 'cal-old');
      expect(same.google.createCalendar).not.toHaveBeenCalled();
      expect(same.google.revoke).not.toHaveBeenCalled();
      expect(same.tenantDb.calendarConnection.rows[0]).toMatchObject({ calendarId: 'cal-old', status: 'CONNECTED', lastError: null });

      const other = setup({
        connections: [connectionRow({ externalAccountId: 'sub-old' })],
        index: [{ id: 'i1', externalAccountId: 'sub-old', tenantSlug: 'acme', userId: 'u1' }],
        links: [{ id: 'l1', userId: 'u1', source: 's', key: 'k', status: 'SYNCED', attempts: 1, lastError: null }],
      });
      await connect(other);
      expect(other.google.revoke).toHaveBeenCalledWith(REFRESH);
      expect(other.google.createCalendar).toHaveBeenCalledTimes(1);
      expect(other.tenantDb.calendarConnection.rows[0]).toMatchObject({ externalAccountId: 'sub-ann', calendarId: 'cal-new' });
      expect(other.prisma.calendarAccountIndex.rows).toEqual([expect.objectContaining({ externalAccountId: 'sub-ann', userId: 'u1' })]);
      // The new calendar is empty: everything the user had is pushed to it again
      expect(other.tenantDb.calendarEventLink.rows[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    });

    it('a calendar deleted in Google is replaced on reconnect', async () => {
      const ctx = setup({ connections: [connectionRow({ status: 'NEEDS_RECONNECT', lastError: 'calendar was deleted' })] });
      ctx.google.calendarExists.mockResolvedValueOnce(false);

      await connect(ctx);

      expect(ctx.google.createCalendar).toHaveBeenCalledTimes(1);
      expect(ctx.google.revoke).not.toHaveBeenCalled();
      expect(ctx.tenantDb.calendarConnection.rows[0].calendarId).toBe('cal-new');
    });
  });

  describe('disconnecting', () => {
    const shared = (externalAccountId = 'sub-ann') => [
      { id: 'i1', externalAccountId, tenantSlug: 'acme', userId: 'u1' },
      { id: 'i2', externalAccountId, tenantSlug: 'beta', userId: 'u9' },
    ];

    it('disconnect revokes when no other connection uses the account', async () => {
      const ctx = setup({ connections: [connectionRow()], index: [{ id: 'i1', externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' }] });

      await ctx.service.disconnect('acme', 'u1', { deleteCalendar: false });

      expect(ctx.google.revoke).toHaveBeenCalledWith(REFRESH);
      expect(ctx.google.deleteCalendar).not.toHaveBeenCalled();
    });

    it("disconnect does NOT revoke when another tenant's connection uses the same account", async () => {
      const ctx = setup({ connections: [connectionRow()], index: shared() });

      await ctx.service.disconnect('acme', 'u1', { deleteCalendar: false });

      expect(ctx.google.revoke).not.toHaveBeenCalled();
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([expect.objectContaining({ tenantSlug: 'beta', userId: 'u9' })]);
    });

    it('disconnect with deleteCalendar deletes the calendar first', async () => {
      const ctx = setup({ connections: [connectionRow()] });

      await ctx.service.disconnect('acme', 'u1', { deleteCalendar: true });

      expect(ctx.google.deleteCalendar).toHaveBeenCalledWith(ACCESS, 'cal-old');
      expect(ctx.google.deleteCalendar.mock.invocationCallOrder[0]).toBeLessThan(ctx.google.revoke.mock.invocationCallOrder[0]);
      expect(ctx.tenantDb.calendarConnection.rows[0].calendarId).toBeNull();
    });

    it('a calendar that could not be deleted leaves the connection as it was', async () => {
      const ctx = setup({ connections: [connectionRow()] });
      ctx.google.deleteCalendar.mockRejectedValueOnce(new GoogleApiError('RETRYABLE', 503, 'Deleting the calendar: Google is busy (HTTP 503)'));

      await expect(ctx.service.disconnect('acme', 'u1', { deleteCalendar: true })).rejects.toThrow(/calendar/);
      expect(ctx.tenantDb.calendarConnection.rows[0]).toMatchObject({ status: 'CONNECTED', refreshTokenEnc: expect.stringMatching(/^v1:/) });
      expect(ctx.google.revoke).not.toHaveBeenCalled();
    });

    it('disconnect keeps the event links of a calendar left in Google, deletes the index row, and drops the token', async () => {
      const ctx = setup({
        connections: [connectionRow(), connectionRow({ id: 'conn-2', userId: 'u2' })],
        index: [{ id: 'i1', externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' }],
        links: [
          { id: 'l1', userId: 'u1', source: 's', key: 'a', status: 'SYNCED' },
          { id: 'l2', userId: 'u2', source: 's', key: 'b', status: 'SYNCED' },
        ],
      });

      await ctx.service.disconnect('acme', 'u1', { deleteCalendar: false });

      // Kept, so reconnecting to this calendar can bring it up to date
      expect(ctx.tenantDb.calendarEventLink.rows.map((l) => l.id)).toEqual(['l1', 'l2']);
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([]);
      const row = ctx.tenantDb.calendarConnection.rows.find((r) => r.userId === 'u1');
      expect(row).toMatchObject({ status: 'DISCONNECTED', refreshTokenEnc: '', calendarId: 'cal-old' });
    });

    it("disconnect with deleteCalendar deletes the user's event links with the calendar", async () => {
      const ctx = setup({
        connections: [connectionRow()],
        links: [{ id: 'l1', userId: 'u1', source: 's', key: 'a', status: 'SYNCED' }],
      });

      await ctx.service.disconnect('acme', 'u1', { deleteCalendar: true });

      expect(ctx.tenantDb.calendarEventLink.rows).toEqual([]);
    });

    it('offboard deletes the calendar, revokes if unshared and removes connection, index and links', async () => {
      const ctx = setup({
        connections: [connectionRow()],
        index: [{ id: 'i1', externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' }],
        links: [{ id: 'l1', userId: 'u1', source: 's', key: 'a', status: 'SYNCED' }],
      });

      await ctx.service.offboard('acme', 'u1');

      expect(ctx.google.deleteCalendar).toHaveBeenCalledWith(ACCESS, 'cal-old');
      expect(ctx.google.revoke).toHaveBeenCalledWith(REFRESH);
      expect(ctx.tenantDb.calendarConnection.rows).toEqual([]);
      expect(ctx.tenantDb.calendarEventLink.rows).toEqual([]);
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([]);
    });

    it('offboard with a dead token still removes local data, and tells no one to reconnect', async () => {
      const ctx = setup({
        connections: [connectionRow()],
        index: [{ id: 'i1', externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' }],
        links: [{ id: 'l1', userId: 'u1', source: 's', key: 'a', status: 'SYNCED' }],
      });
      ctx.google.refreshAccessToken.mockRejectedValueOnce(new GoogleApiError('INVALID_GRANT', 400, 'Refreshing Google access: Google access was revoked or has expired'));

      await ctx.service.offboard('acme', 'u1');

      expect(ctx.google.deleteCalendar).not.toHaveBeenCalled();
      expect(ctx.tenantDb.calendarConnection.rows).toEqual([]);
      expect(ctx.tenantDb.calendarEventLink.rows).toEqual([]);
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([]);
      expect(ctx.events.emit).not.toHaveBeenCalled();
    });
  });

  describe('tenant deletion', () => {
    it('offboardTenant offboards every connected user while their tokens still exist', async () => {
      const ctx = setup({
        connections: [connectionRow(), connectionRow({ id: 'conn-2', userId: 'u2', externalAccountId: 'sub-bob', calendarId: 'cal-bob' })],
        index: [
          { id: 'i1', externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' },
          { id: 'i2', externalAccountId: 'sub-bob', tenantSlug: 'acme', userId: 'u2' },
        ],
        links: [{ id: 'l1', userId: 'u1', source: 's', key: 'a', status: 'SYNCED' }],
      });
      ctx.google.deleteCalendar.mockRejectedValueOnce(new Error('Google down')); // one failure doesn't stop the rest

      await ctx.service.offboardTenant('acme');

      expect(ctx.google.deleteCalendar.mock.calls.map((call) => (call as unknown[])[1])).toEqual(['cal-old', 'cal-bob']);
      expect(ctx.tenantDb.calendarConnection.rows).toEqual([]);
      expect(ctx.tenantDb.calendarEventLink.rows).toEqual([]);
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([]);
    });

    it("forgetTenant deletes only that tenant's account-index rows", async () => {
      const ctx = setup({
        index: [
          { id: 'i1', externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' },
          { id: 'i2', externalAccountId: 'sub-ann', tenantSlug: 'beta', userId: 'u9' },
        ],
      });

      await ctx.service.forgetTenant('acme');

      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([expect.objectContaining({ tenantSlug: 'beta' })]);
    });
  });

  describe('broken connections and access tokens', () => {
    it('markNeedsReconnect emits DISCONNECTED once, not on every call', async () => {
      const ctx = setup({ connections: [connectionRow()] });

      await ctx.service.markNeedsReconnect('acme', 'u1', 'Google access was revoked');
      await ctx.service.markNeedsReconnect('acme', 'u1', 'Google access was revoked');

      expect(ctx.events.emit).toHaveBeenCalledTimes(1);
      expect(ctx.events.emit).toHaveBeenCalledWith(SystemEvents.INTEGRATION_CALENDAR_DISCONNECTED, expect.objectContaining({
        tenantSlug: 'acme', userId: 'u1', reason: 'Google access was revoked',
      }));
      expect(ctx.tenantDb.calendarConnection.rows[0]).toMatchObject({ status: 'NEEDS_RECONNECT', lastError: 'Google access was revoked' });
    });

    it('markNeedsReconnect says which features stopped working: those that were ready', async () => {
      const cases: Array<[Row, string[]]> = [
        [connectionRow({ scopes: `openid ${MEET_SCOPE}`, calendarId: null }), ['meetings']],
        [connectionRow({ scopes: `openid ${CALENDAR_SCOPE} ${MEET_SCOPE}` }), ['calendar', 'meetings']],
        [connectionRow({ scopes: `openid ${CALENDAR_SCOPE}` }), ['calendar']],
      ];
      for (const [row, features] of cases) {
        const ctx = setup({ pluginConfig: BOTH, connections: [row] });
        await ctx.service.markNeedsReconnect('acme', 'u1', 'Google access was revoked');
        expect(ctx.events.emit).toHaveBeenCalledWith(SystemEvents.INTEGRATION_CALENDAR_DISCONNECTED, expect.objectContaining({ features }));
      }
    });

    it('accessToken refreshes once and reuses the token until a minute before it expires', async () => {
      const ctx = setup({ connections: [connectionRow()] });

      await expect(ctx.service.accessToken('acme', 'u1')).resolves.toEqual({ token: ACCESS, calendarId: 'cal-old' });
      await ctx.service.accessToken('acme', 'u1');
      expect(ctx.google.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(ctx.google.refreshAccessToken).toHaveBeenCalledWith(REFRESH);

      ctx.google.refreshAccessToken.mockResolvedValueOnce({ accessToken: 'short', expiresAt: Date.now() + 30_000 });
      ctx.service.forgetAccessToken('acme', 'u1');
      await ctx.service.accessToken('acme', 'u1');
      await ctx.service.accessToken('acme', 'u1');
      expect(ctx.google.refreshAccessToken).toHaveBeenCalledTimes(3);
    });

    it("accessToken ignores a cached token for another calendar (another instance's reconnect)", async () => {
      const ctx = setup({ connections: [connectionRow()] });
      await ctx.service.accessToken('acme', 'u1', 'cal-old');
      ctx.tenantDb.calendarConnection.rows[0].calendarId = 'cal-other';

      await expect(ctx.service.accessToken('acme', 'u1', 'cal-other')).resolves.toEqual({ token: ACCESS, calendarId: 'cal-other' });
      expect(ctx.google.refreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it('accessToken on a revoked grant marks the connection NEEDS_RECONNECT and fails permanently', async () => {
      const ctx = setup({ connections: [connectionRow()] });
      ctx.google.refreshAccessToken.mockRejectedValueOnce(new GoogleApiError('INVALID_GRANT', 400, 'Refreshing Google access: Google access was revoked or has expired'));

      await expect(ctx.service.accessToken('acme', 'u1')).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });
      expect(ctx.tenantDb.calendarConnection.rows[0].status).toBe('NEEDS_RECONNECT');
      expect(ctx.events.emit).toHaveBeenCalledWith(SystemEvents.INTEGRATION_CALENDAR_DISCONNECTED, expect.anything());
    });

    it("accessToken failing for the platform's client (unauthorized or rejected) marks nobody", async () => {
      for (const error of [
        new GoogleApiError('UNAUTHORIZED', 401, 'Refreshing Google access: Google did not accept the credentials'),
        new GoogleApiError('REJECTED', 401, 'Refreshing Google access: The OAuth client was not found.'),
      ]) {
        const ctx = setup({ connections: [connectionRow()] });
        ctx.google.refreshAccessToken.mockRejectedValueOnce(error);

        await expect(ctx.service.accessToken('acme', 'u1')).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });
        expect(ctx.tenantDb.calendarConnection.rows[0].status).toBe('CONNECTED');
        expect(ctx.events.emit).not.toHaveBeenCalled();
      }
    });

    it('accessToken while Google is busy is retryable and keeps the connection', async () => {
      const ctx = setup({ connections: [connectionRow()] });
      ctx.google.refreshAccessToken.mockRejectedValueOnce(new GoogleApiError('RETRYABLE', 503, 'Refreshing Google access: Google is busy (HTTP 503)'));

      await expect(ctx.service.accessToken('acme', 'u1')).rejects.toMatchObject({ code: 'CALENDAR_RETRYABLE' });
      expect(ctx.tenantDb.calendarConnection.rows[0].status).toBe('CONNECTED');
    });
  });

  describe('views and settings', () => {
    it('no ConnectionView or listUsers result contains the refresh token or the access token', async () => {
      const ctx = setup();
      const connected = await connect(ctx);

      const outputs = [connected, await ctx.service.myStatus('acme', 'u1'), await ctx.service.listUsers('acme')];

      for (const output of outputs) {
        const json = JSON.stringify(output);
        expect(json).not.toContain(REFRESH);
        expect(json).not.toContain(ACCESS);
        expect(json).not.toContain('v1:');
      }
      expect(await ctx.service.listUsers('acme')).toEqual([
        expect.objectContaining({ userId: 'u1', name: 'Ann', email: 'ann@acme.test', status: 'CONNECTED', accountEmail: 'ann@gmail.test' }),
      ]);
    });

    it('myStatus reports configured, enabled and the connection with its synced event count', async () => {
      const ctx = setup({
        connections: [connectionRow()],
        links: [
          { id: 'l1', userId: 'u1', source: 's', key: 'a', status: 'SYNCED' },
          { id: 'l2', userId: 'u1', source: 's', key: 'b', status: 'PENDING' },
        ],
      });

      await expect(ctx.service.myStatus('acme', 'u1')).resolves.toMatchObject({
        configured: true,
        calendar: { enabled: true },
        meet: { enabled: false, defaultAccess: 'TRUSTED' },
        connection: { status: 'CONNECTED', syncedEvents: 1, features: { calendar: 'ready', meet: 'off' } },
      });
      await expect(ctx.service.myStatus('acme', 'u2')).resolves.toMatchObject({ connection: null });
    });

    it('updateSettings switches Calendar: stores the flag and resyncs on, not off', async () => {
      const ctx = setup({ pluginConfig: { webhookTimeoutMs: 5000 } });

      await ctx.service.updateSettings('acme', { calendarEnabled: true });
      expect(ctx.tenantDb.plugin.rows[0].config).toMatchObject({ webhookTimeoutMs: 5000, googleCalendar: { enabled: true } });
      expect(ctx.calendarSync.resync).toHaveBeenCalledWith('acme', undefined); // every user
      await expect(ctx.service.isEnabled('acme')).resolves.toBe(true);

      ctx.calendarSync.resync.mockClear();
      await ctx.service.updateSettings('acme', { calendarEnabled: false });
      expect(ctx.tenantDb.plugin.rows[0].config).toMatchObject({ webhookTimeoutMs: 5000, googleCalendar: { enabled: false } });
      expect(ctx.calendarSync.resync).not.toHaveBeenCalled();
      await expect(ctx.service.isEnabled('acme')).resolves.toBe(false);
    });
  });

  describe('Calendar and Meet on one connection', () => {
    const tokensWith = async (ctx: Ctx, scopes: string) => ({ ...(await ctx.google.exchangeCode()), scopes });

    it('startConnect asks for exactly the scopes of the features the tenant has on', async () => {
      const cases: Array<[unknown, string[]]> = [
        [{ googleCalendar: { enabled: true } }, ['openid', 'email', CALENDAR_SCOPE]],
        [MEET_ONLY, ['openid', 'email', MEET_SCOPE]],
        [BOTH, ['openid', 'email', CALENDAR_SCOPE, MEET_SCOPE]],
      ];
      for (const [pluginConfig, scopes] of cases) {
        const ctx = setup({ pluginConfig });
        await ctx.service.startConnect('acme', 'u1');
        expect(ctx.google.authUrl.mock.calls[0][2]).toEqual(scopes);
      }
    });

    it('startConnect is refused when Calendar and Meet are both off', async () => {
      const ctx = setup({ pluginConfig: { googleCalendar: { enabled: false }, googleMeet: { enabled: false } } });
      await expect(ctx.service.startConnect('acme', 'u1')).rejects.toThrow('Google Calendar and Google Meet are switched off for your organization.');
    });

    it('a Meet-only consent connects without creating a calendar, and Calendar then reports needs-permission', async () => {
      const ctx = setup({ pluginConfig: MEET_ONLY });
      ctx.google.exchangeCode.mockResolvedValueOnce(await tokensWith(ctx, `openid ${MEET_SCOPE} https://www.googleapis.com/auth/userinfo.email`));

      const view = await connect(ctx);

      expect(ctx.google.createCalendar).not.toHaveBeenCalled();
      expect(ctx.tenantDb.calendarConnection.rows[0]).toMatchObject({ status: 'CONNECTED', calendarId: null, scopes: expect.stringContaining(MEET_SCOPE) });
      expect(view.features).toEqual({ calendar: 'off', meet: 'ready' });

      ctx.tenantDb.plugin.rows[0].config = BOTH;
      expect((await ctx.service.myStatus('acme', 'u1')).connection?.features).toEqual({ calendar: 'needs-permission', meet: 'ready' });
    });

    it('a consent that unticked Meet keeps Calendar working and reports Meet needs-permission', async () => {
      const ctx = setup({ pluginConfig: BOTH });

      const view = await connect(ctx); // the default consent grants Calendar only

      expect(ctx.google.createCalendar).toHaveBeenCalledTimes(1);
      expect(view.features).toEqual({ calendar: 'ready', meet: 'needs-permission' });
    });

    it('a consent granting none of the requested features is refused and nothing is saved', async () => {
      const ctx = setup({ pluginConfig: MEET_ONLY }); // the default consent grants Calendar, not Meet

      await expect(connect(ctx)).rejects.toThrow("Google didn't grant access to Meet. Connect again and allow access.");
      expect(ctx.tenantDb.calendarConnection.rows).toEqual([]);
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([]);
    });

    it('the refusal names only the features the tenant asked for', async () => {
      const calendarOnly = setup();
      calendarOnly.google.exchangeCode.mockResolvedValueOnce(await tokensWith(calendarOnly, 'openid email'));
      await expect(connect(calendarOnly)).rejects.toThrow("Google didn't grant access to Calendar. Connect again and allow access.");

      const both = setup({ pluginConfig: BOTH });
      both.google.exchangeCode.mockResolvedValueOnce(await tokensWith(both, 'openid email'));
      await expect(connect(both)).rejects.toThrow("Google didn't grant access to Calendar or Meet. Connect again and allow access.");
    });

    it('allowing Meet later on a Calendar connection keeps the same calendar and adds the scope', async () => {
      const ctx = setup({ pluginConfig: BOTH, connections: [connectionRow()] });
      ctx.google.exchangeCode.mockResolvedValueOnce(await tokensWith(ctx, `openid ${CALENDAR_SCOPE} ${MEET_SCOPE}`));

      const view = await connect(ctx);

      expect(ctx.google.createCalendar).not.toHaveBeenCalled();
      expect(ctx.tenantDb.calendarConnection.rows[0]).toMatchObject({ calendarId: 'cal-old', scopes: expect.stringContaining(MEET_SCOPE) });
      expect(view.features).toEqual({ calendar: 'ready', meet: 'ready' });
    });

    it('googleAccessToken fails for a connection without the scope, and ignores a cached token of another account', async () => {
      const ctx = setup({ connections: [connectionRow()] }); // Calendar scope only
      await expect(ctx.service.googleAccessToken('acme', 'u1', MEET_SCOPE)).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });
      expect(ctx.google.refreshAccessToken).not.toHaveBeenCalled();

      ctx.tenantDb.calendarConnection.rows[0].scopes = `openid ${CALENDAR_SCOPE} ${MEET_SCOPE}`;
      await expect(ctx.service.googleAccessToken('acme', 'u1', MEET_SCOPE)).resolves.toEqual({ token: ACCESS, accountId: 'sub-ann' });
      await ctx.service.googleAccessToken('acme', 'u1', MEET_SCOPE, 'sub-ann');
      expect(ctx.google.refreshAccessToken).toHaveBeenCalledTimes(1);

      await ctx.service.googleAccessToken('acme', 'u1', MEET_SCOPE, 'sub-other');
      expect(ctx.google.refreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it('updateSettings stores the Meet switch and default access, keeps other config keys, and resyncs only when Calendar is switched on', async () => {
      const ctx = setup({ pluginConfig: { webhookTimeoutMs: 5000, googleCalendar: { enabled: false } } });

      await ctx.service.updateSettings('acme', { meetEnabled: true, meetDefaultAccess: 'OPEN' });
      expect(ctx.tenantDb.plugin.rows[0].config).toMatchObject({
        webhookTimeoutMs: 5000, googleCalendar: { enabled: false }, googleMeet: { enabled: true, defaultAccess: 'OPEN' },
      });
      expect(ctx.calendarSync.resync).not.toHaveBeenCalled();

      await ctx.service.updateSettings('acme', { calendarEnabled: true });
      expect(ctx.calendarSync.resync).toHaveBeenCalledWith('acme', undefined);
      await expect(ctx.service.featureSwitches('acme')).resolves.toEqual({ calendar: true, meet: true, meetDefaultAccess: 'OPEN' });
      await expect(ctx.service.isMeetEnabled('acme')).resolves.toBe(true);
    });

    it('myStatus and listUsers report per-feature states and never contain a token', async () => {
      const ctx = setup({ pluginConfig: BOTH, connections: [connectionRow({ scopes: `openid ${CALENDAR_SCOPE} ${MEET_SCOPE}` })] });

      const status = await ctx.service.myStatus('acme', 'u1');
      const users = await ctx.service.listUsers('acme');

      expect(status).toMatchObject({ calendar: { enabled: true }, meet: { enabled: true, defaultAccess: 'TRUSTED' }, connection: { features: { calendar: 'ready', meet: 'ready' } } });
      expect(users[0]).toMatchObject({ userId: 'u1', features: { calendar: 'ready', meet: 'ready' } });
      for (const json of [JSON.stringify(status), JSON.stringify(users)]) {
        expect(json).not.toContain(REFRESH);
        expect(json).not.toContain('v1:');
      }
    });
  });

  describe('connection states', () => {
    it('features of a connection that needs reconnecting or was disconnected are not-connected, never ready', async () => {
      for (const status of ['NEEDS_RECONNECT', 'DISCONNECTED']) {
        const ctx = setup({
          pluginConfig: { googleCalendar: { enabled: true }, googleMeet: { enabled: false } },
          connections: [connectionRow({ status, scopes: `openid ${CALENDAR_SCOPE} ${MEET_SCOPE}` })],
        });
        expect((await ctx.service.myStatus('acme', 'u1')).connection?.features).toEqual({ calendar: 'not-connected', meet: 'off' });
        expect((await ctx.service.listUsers('acme'))[0].features).toEqual({ calendar: 'not-connected', meet: 'off' });
      }
    });

    it('myStatus counts the active meetings the user hosts, whatever the Meet switch', async () => {
      const ctx = setup({
        connections: [connectionRow()],
        spaces: [
          { id: 's1', hostUserId: 'u1', status: 'ACTIVE' },
          { id: 's2', hostUserId: 'u1', status: 'CANCELLED' },
          { id: 's3', hostUserId: 'u2', status: 'ACTIVE' },
        ],
      });

      expect((await ctx.service.myStatus('acme', 'u1')).connection?.activeMeetings).toBe(1);
      await expect(ctx.service.activeMeetingCount('acme', 'u1')).resolves.toBe(1);
      await expect(ctx.service.activeMeetingCount('acme', 'u2')).resolves.toBe(1);
    });
  });

  describe('meetings across the connection', () => {
    const withMeet = (overrides: Record<string, unknown> = {}) => connectionRow({ scopes: `openid email ${CALENDAR_SCOPE} ${MEET_SCOPE}`, ...overrides });

    it("disconnect locks and orphans the user's meetings before revoking", async () => {
      const ctx = setup({ connections: [withMeet()] });

      await ctx.service.disconnect('acme', 'u1', { deleteCalendar: false });

      expect(ctx.meetSpaces.lockHostSpaces).toHaveBeenCalledWith('acme', 'u1', ACCESS, 'The host disconnected Google');
      expect(ctx.meetSpaces.lockHostSpaces.mock.invocationCallOrder[0]).toBeLessThan(ctx.google.revoke.mock.invocationCallOrder[0]);
    });

    it('offboard retries a busy token refresh within about 5 s, then locks FAILED without a token and deletes the token anyway', async () => {
      const ctx = setup({ connections: [withMeet()], index: [{ id: 'i1', externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' }] });
      const sleep = ((ctx.service as any).sleep = jest.fn(async () => undefined));
      ctx.google.refreshAccessToken.mockRejectedValue(new GoogleApiError('RETRYABLE', 503, 'Refreshing Google access: Google is busy (HTTP 503)'));

      await ctx.service.offboard('acme', 'u1');

      expect(ctx.google.refreshAccessToken).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls).toEqual([[1_000], [3_000]]);
      // No token could be had: the meetings are locked "final" without one, i.e. recorded as FAILED
      expect(ctx.meetSpaces.lockHostSpaces).toHaveBeenCalledWith('acme', 'u1', null, 'The host left the organization');
      expect(ctx.tenantDb.calendarConnection.rows).toEqual([]);
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([]);
    });

    it('offboard locks with the token a retried refresh brings; a dead grant or a spent budget is not retried', async () => {
      const busyOnce = setup({ connections: [withMeet()] });
      (busyOnce.service as any).sleep = jest.fn(async () => undefined);
      busyOnce.google.refreshAccessToken.mockRejectedValueOnce(new GoogleApiError('RETRYABLE', 503, 'busy'));
      await busyOnce.service.offboard('acme', 'u1');
      expect(busyOnce.meetSpaces.lockHostSpaces).toHaveBeenCalledWith('acme', 'u1', ACCESS, 'The host left the organization');

      const dead = setup({ connections: [withMeet()] });
      (dead.service as any).sleep = jest.fn(async () => undefined);
      dead.google.refreshAccessToken.mockRejectedValue(new GoogleApiError('INVALID_GRANT', 400, 'revoked'));
      await dead.service.offboard('acme', 'u1');
      expect(dead.google.refreshAccessToken).toHaveBeenCalledTimes(1);

      const slow = setup({ connections: [withMeet()] });
      (slow.service as any).sleep = jest.fn(async () => undefined);
      // The first refresh hung until its timeout
      (slow.service as any).now = jest.fn().mockReturnValueOnce(0).mockReturnValue(15_000);
      slow.google.refreshAccessToken.mockRejectedValue(new GoogleApiError('RETRYABLE', 0, 'could not reach Google (TimeoutError)'));
      await slow.service.offboard('acme', 'u1');
      expect(slow.google.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it('disconnect retries a busy token refresh and locks the meetings with the token it got', async () => {
      const ctx = setup({ connections: [withMeet()] });
      (ctx.service as any).sleep = jest.fn(async () => undefined);
      ctx.google.refreshAccessToken.mockRejectedValueOnce(new GoogleApiError('RETRYABLE', 503, 'busy'));

      await ctx.service.disconnect('acme', 'u1', { deleteCalendar: false });

      expect(ctx.meetSpaces.lockHostSpaces).toHaveBeenCalledWith('acme', 'u1', ACCESS, 'The host disconnected Google');
    });

    it("offboard still forgets the departed user's token when locking their meetings fails", async () => {
      const ctx = setup({ connections: [withMeet()], index: [{ id: 'i1', externalAccountId: 'sub-ann', tenantSlug: 'acme', userId: 'u1' }] });
      ctx.meetSpaces.lockHostSpaces.mockRejectedValueOnce(new Error('relation "integration_meeting_space" does not exist'));

      await expect(ctx.service.offboard('acme', 'u1')).resolves.toBeUndefined();

      expect(ctx.google.revoke).toHaveBeenCalled();
      expect(ctx.tenantDb.calendarConnection.rows).toEqual([]);
      expect(ctx.prisma.calendarAccountIndex.rows).toEqual([]);
    });

    it("offboard locks the meetings first, with the user's token, before deleting the calendar and revoking", async () => {
      const ctx = setup({ connections: [withMeet()] });

      await ctx.service.offboard('acme', 'u1');

      expect(ctx.meetSpaces.lockHostSpaces).toHaveBeenCalledWith('acme', 'u1', ACCESS, 'The host left the organization');
      const lockedAt = ctx.meetSpaces.lockHostSpaces.mock.invocationCallOrder[0];
      expect(lockedAt).toBeLessThan(ctx.google.deleteCalendar.mock.invocationCallOrder[0]);
      expect(lockedAt).toBeLessThan(ctx.google.revoke.mock.invocationCallOrder[0]);
    });

    it("offboardTenant locks every host's meetings before the schema is dropped", async () => {
      const ctx = setup({ connections: [withMeet(), withMeet({ id: 'conn-2', userId: 'u2', externalAccountId: 'sub-bob' })] });

      await ctx.service.offboardTenant('acme');

      expect(ctx.meetSpaces.lockHostSpaces.mock.calls.map((call) => (call as unknown[])[1])).toEqual(['u1', 'u2']);
    });

    it("switching Google accounts locks the old account's meetings with the old token; a dead old token makes them FAILED", async () => {
      const ctx = setup({ pluginConfig: BOTH, connections: [withMeet({ externalAccountId: 'sub-old' })] });
      ctx.google.exchangeCode.mockResolvedValueOnce({ ...(await ctx.google.exchangeCode()), scopes: `openid ${CALENDAR_SCOPE} ${MEET_SCOPE}` });

      await connect(ctx);

      expect(ctx.meetSpaces.lockHostSpaces).toHaveBeenCalledWith('acme', 'u1', ACCESS, 'The host switched Google accounts');
      expect(ctx.meetSpaces.lockHostSpaces.mock.invocationCallOrder[0]).toBeLessThan(ctx.google.revoke.mock.invocationCallOrder[0]);

      const dead = setup({ pluginConfig: BOTH, connections: [withMeet({ externalAccountId: 'sub-old' })] });
      dead.google.refreshAccessToken.mockRejectedValueOnce(new GoogleApiError('INVALID_GRANT', 400, 'Refreshing Google access: Google access was revoked or has expired'));
      await connect(dead);
      expect(dead.meetSpaces.lockHostSpaces).toHaveBeenCalledWith('acme', 'u1', null, 'The host switched Google accounts');
    });

    it('reconnecting the same account finishes PENDING locks', async () => {
      const ctx = setup({ pluginConfig: BOTH, connections: [withMeet({ status: 'NEEDS_RECONNECT' })] });
      ctx.google.exchangeCode.mockResolvedValueOnce({ ...(await ctx.google.exchangeCode()), scopes: `openid ${CALENDAR_SCOPE} ${MEET_SCOPE}` });

      await connect(ctx);

      expect(ctx.meetSpaces.retryPending).toHaveBeenCalledWith('acme', 'u1', ACCESS, 'sub-ann');
      expect(ctx.meetSpaces.lockHostSpaces).not.toHaveBeenCalled();
    });
  });
});
