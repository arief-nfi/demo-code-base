import { Prisma } from '@saas/database';
import { GoogleApiError } from './google-api';
import { googleEventId } from './google-event-id';
import { GoogleCalendarProvider } from './google-calendar.provider';
import type { GoogleCalendarConfig } from './google-calendar.config';

const config: GoogleCalendarConfig = {
  clientId: 'cid',
  clientSecret: 'csecret',
  encryptionKey: Buffer.alloc(32, 1).toString('base64'),
  redirectUri: 'https://app.test/cb',
  appName: 'Acme Cloud',
  configured: true,
};

const ref = { tenantSlug: 'acme', userId: 'u1', source: 'sample-plugin', key: 'article:42' };
const event = {
  title: 'Published: Hello',
  start: '2026-11-02T09:00:00.000Z',
  end: '2026-11-02T09:30:00.000Z',
  allDay: false,
  timeZone: 'Asia/Jakarta',
  description: 'An article went live.',
  location: 'Blog',
  url: 'https://app.test/articles/42',
};

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[field]);
      if ('not' in condition) return row[field] !== condition.not;
      return matches(row, condition); // compound unique, e.g. userId_source_key
    }
    if (condition instanceof Date) return row[field]?.getTime() === condition.getTime();
    return row[field] === condition;
  });
}

/** In-memory model with Prisma's habits: copies out, DbNull stored as null, @updatedAt bumped on writes */
function fakeModel(initial: Row[] = []) {
  let clock = 1_000;
  const tick = () => new Date(++clock);
  const apply = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v === Prisma.DbNull) row[k] = null;
      else if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] ?? 0) + v.increment;
      else row[k] = v;
    }
    row.updatedAt = tick();
  };
  const rows: Row[] = initial.map((row) => ({ updatedAt: tick(), ...row }));
  let seq = 0;
  return {
    rows,
    findUnique: jest.fn(async ({ where }: Row) => {
      const row = rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r }))),
    upsert: jest.fn(async ({ where, create, update }: Row) => {
      const row = rows.find((r) => matches(r, where));
      if (row) {
        apply(row, update);
        return { ...row };
      }
      const created: Row = { id: `id-${++seq}`, attempts: 0 };
      apply(created, create);
      rows.push(created);
      return { ...created };
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where }: Row = {}) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: before - rows.length };
    }),
  };
}

const CALENDAR_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.app.created';
const MEET_ONLY_SCOPES = 'openid email https://www.googleapis.com/auth/meetings.space.created';

function setup(opts: { connectionStatus?: string | null; enabled?: boolean; usable?: boolean; links?: Row[]; scopes?: string; calendarId?: string | null } = {}) {
  const status = opts.connectionStatus === undefined ? 'CONNECTED' : opts.connectionStatus;
  const tenantDb = {
    calendarConnection: fakeModel(status ? [{ id: 'c1', userId: 'u1', status, scopes: opts.scopes ?? CALENDAR_SCOPES, calendarId: opts.calendarId === undefined ? 'cal-1' : opts.calendarId }] : []),
    calendarEventLink: fakeModel(opts.links),
    plugin: { findUnique: jest.fn(async () => ({ key: 'integration', isEnabled: opts.usable ?? true })) },
    tenantSubscription: { findMany: jest.fn(async () => []) },
  };
  const prisma = {
    plugin: { findUnique: jest.fn(async () => ({ key: 'integration', isEnabled: true, pricingModel: 'FREE' })) },
    getTenantClient: jest.fn(() => tenantDb),
  };
  const cache = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
  const google = {
    putEvent: jest.fn(async () => undefined),
    deleteEvent: jest.fn(async () => undefined),
    calendarExists: jest.fn(async () => true),
  };
  const connections = {
    isEnabled: jest.fn(async () => opts.enabled ?? true),
    accessToken: jest.fn(async () => ({ token: 'ya29.token', calendarId: 'cal-1' })),
    forgetAccessToken: jest.fn(),
    markNeedsReconnect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    featureStates: jest.fn(async () => ({ calendar: 'ready', meet: 'needs-permission' })),
    activeMeetingCount: jest.fn(async () => 2),
  };
  const provider = new GoogleCalendarProvider(prisma as any, cache as any, google as any, config, connections as any);
  return { provider, tenantDb, google, connections };
}

type Ctx = ReturnType<typeof setup>;
const link = (ctx: Ctx) => ctx.tenantDb.calendarEventLink.rows[0];

describe('GoogleCalendarProvider', () => {
  it('record stores the requested state with the deterministic id and returns the connection state', async () => {
    const ctx = setup();

    await expect(ctx.provider.record({ ...ref, op: 'upsert', event })).resolves.toBe('connected');

    expect(link(ctx)).toMatchObject({
      userId: 'u1', source: 'sample-plugin', key: 'article:42',
      externalEventId: googleEventId('acme', 'u1', 'sample-plugin', 'article:42'),
      desired: event, status: 'PENDING',
    });

    const paused = setup({ connectionStatus: 'NEEDS_RECONNECT' });
    await expect(paused.provider.record({ ...ref, op: 'remove' })).resolves.toBe('paused-reconnect');
    expect(link(paused)).toMatchObject({ desired: null, status: 'PENDING' });
  });

  it("record for a disconnected user updates the events kept for their calendar, and stores nothing new", async () => {
    const ctx = setup({
      connectionStatus: 'DISCONNECTED',
      links: [{ id: 'l1', userId: 'u1', source: 'sample-plugin', key: 'article:42', externalEventId: 'e1', desired: event, status: 'SYNCED', attempts: 1, lastError: null }],
    });

    await expect(ctx.provider.record({ ...ref, op: 'remove' })).resolves.toBe('paused-reconnect');
    expect(link(ctx)).toMatchObject({ desired: null, status: 'PENDING' });

    await expect(ctx.provider.record({ ...ref, key: 'article:99', op: 'upsert', event })).resolves.toBe('none');
    expect(ctx.tenantDb.calendarEventLink.rows).toHaveLength(1);
  });

  it('record for a Meet-only connection (no calendar scope, no calendar) stores nothing and returns none', async () => {
    for (const ctx of [setup({ scopes: MEET_ONLY_SCOPES, calendarId: null }), setup({ calendarId: null }), setup({ scopes: MEET_ONLY_SCOPES })]) {
      await expect(ctx.provider.record({ ...ref, op: 'upsert', event })).resolves.toBe('none');
      expect(ctx.tenantDb.calendarEventLink.rows).toEqual([]);
    }
  });

  it('pendingRefs skips connections without a calendar', async () => {
    const ctx = setup({ scopes: MEET_ONLY_SCOPES, calendarId: null, links: [{ id: 'l1', userId: 'u1', source: 's', key: 'a', status: 'PENDING' }] });

    await expect(ctx.provider.pendingRefs('acme')).resolves.toEqual([]);
  });

  it('apply for a connection without a calendar calls nothing and leaves the row', async () => {
    const ctx = setup({ scopes: MEET_ONLY_SCOPES, calendarId: null, links: [{ id: 'l1', userId: 'u1', source: 'sample-plugin', key: 'article:42', externalEventId: 'e1', desired: event, status: 'PENDING', attempts: 0 }] });

    await ctx.provider.apply(ref);

    expect(ctx.connections.accessToken).not.toHaveBeenCalled();
    expect(ctx.google.putEvent).not.toHaveBeenCalled();
    expect(link(ctx).status).toBe('PENDING');
  });

  it('an existing calendar connection (calendar scope only) records and syncs as before', async () => {
    const ctx = setup({ scopes: CALENDAR_SCOPES });
    await expect(ctx.provider.record({ ...ref, op: 'upsert', event })).resolves.toBe('connected');
    await ctx.provider.apply(ref);
    expect(link(ctx).status).toBe('SYNCED');
  });

  it('record for a user without a connection stores nothing and returns none', async () => {
    for (const connectionStatus of [null, 'DISCONNECTED']) {
      const ctx = setup({ connectionStatus });
      await expect(ctx.provider.record({ ...ref, op: 'upsert', event })).resolves.toBe('none');
      expect(ctx.tenantDb.calendarEventLink.rows).toEqual([]);
    }
  });

  it('apply puts the event with the expected body (description footer, private properties, source link)', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });

    await ctx.provider.apply(ref);

    expect(ctx.google.putEvent).toHaveBeenCalledWith('ya29.token', 'cal-1', googleEventId('acme', 'u1', 'sample-plugin', 'article:42'), {
      summary: 'Published: Hello',
      description: 'An article went live.\n\nOpen in Acme Cloud: https://app.test/articles/42\n\nManaged by Acme Cloud — changes made here may be overwritten.',
      location: 'Blog',
      start: { dateTime: '2026-11-02T09:00:00.000Z', timeZone: 'Asia/Jakarta' },
      end: { dateTime: '2026-11-02T09:30:00.000Z', timeZone: 'Asia/Jakarta' },
      extendedProperties: { private: { source: 'sample-plugin', key: 'article:42' } },
      source: { title: 'Acme Cloud', url: 'https://app.test/articles/42' },
    });
    expect(link(ctx)).toMatchObject({ status: 'SYNCED', attempts: 1, lastError: null });
    expect(link(ctx).syncedAt).toBeInstanceOf(Date);
    // The token must be for the calendar the connection points at now
    expect(ctx.connections.accessToken).toHaveBeenCalledWith('acme', 'u1', 'cal-1');
  });

  it('an all-day event without a link uses dates and only the footer', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event: { title: 'Holiday', start: '2026-12-24', end: '2026-12-25', allDay: true, timeZone: 'UTC' } });

    await ctx.provider.apply(ref);

    const body = (ctx.google.putEvent.mock.calls[0] as unknown[])[3];
    expect(body).toEqual({
      summary: 'Holiday',
      description: 'Managed by Acme Cloud — changes made here may be overwritten.',
      start: { date: '2026-12-24' },
      end: { date: '2026-12-25' },
      extendedProperties: { private: { source: 'sample-plugin', key: 'article:42' } },
    });
  });

  const MEET = 'https://meet.google.com/abc-defg-hij';
  const bodyOf = (ctx: ReturnType<typeof setup>, call = 0) => (ctx.google.putEvent.mock.calls[call] as unknown[])[3] as Record<string, any>;

  it("a Meet link becomes the event's Google Meet, not its location", async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event: { ...event, meetingUrl: MEET } });

    await ctx.provider.apply(ref);

    expect(bodyOf(ctx).conferenceData).toEqual({
      conferenceSolution: { key: { type: 'hangoutsMeet' } },
      entryPoints: [{ entryPointType: 'video', uri: MEET, label: 'meet.google.com/abc-defg-hij' }],
    });
    expect(bodyOf(ctx).location).toBe('Blog');
    expect(bodyOf(ctx).description).not.toContain('meet.google.com');
    expect(link(ctx).status).toBe('SYNCED');
  });

  it.each(['https://zoom.us/j/123456', 'https://meet.google.com.example.org/abc-defg-hij'])(
    'a meeting link that is not Google Meet (%s) goes in the location, or the description when there is one',
    async (meetingUrl) => {
      const ctx = setup();
      await ctx.provider.record({ ...ref, op: 'upsert', event: { ...event, location: undefined, meetingUrl } });
      await ctx.provider.record({ ...ref, key: 'with-location', op: 'upsert', event: { ...event, meetingUrl } });

      await ctx.provider.apply(ref);
      await ctx.provider.apply({ ...ref, key: 'with-location' });

      expect(bodyOf(ctx, 0)).toMatchObject({ location: meetingUrl });
      expect(bodyOf(ctx, 0).conferenceData).toBeUndefined();
      expect(bodyOf(ctx, 1)).toMatchObject({ location: 'Blog', description: expect.stringContaining(`Join the meeting: ${meetingUrl}`) });
      expect(bodyOf(ctx, 1).conferenceData).toBeUndefined();
    },
  );

  it('when Google refuses the conferencing, the event is saved with the Meet link as its location', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event: { ...event, location: undefined, meetingUrl: MEET } });
    ctx.google.putEvent.mockRejectedValueOnce(new GoogleApiError('REJECTED', 400, 'Saving the event: Invalid conference type value.'));

    await ctx.provider.apply(ref);

    expect(ctx.google.putEvent).toHaveBeenCalledTimes(2);
    expect(bodyOf(ctx, 1).conferenceData).toBeUndefined();
    expect(bodyOf(ctx, 1).location).toBe(MEET);
    expect(link(ctx)).toMatchObject({ status: 'SYNCED', lastError: null });
  });

  it('an event Google refuses for another reason still fails, with the conferencing left out or not', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event: { ...event, meetingUrl: MEET } });
    ctx.google.putEvent.mockRejectedValue(new GoogleApiError('REJECTED', 400, 'Saving the event: Invalid start time.'));

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });

    expect(ctx.google.putEvent).toHaveBeenCalledTimes(2);
    expect(link(ctx)).toMatchObject({ status: 'FAILED', lastError: 'Saving the event: Invalid start time.' });
  });

  it('apply of a removed request deletes the event and the row', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'remove' });

    await ctx.provider.apply(ref);

    expect(ctx.google.deleteEvent).toHaveBeenCalledWith('ya29.token', 'cal-1', googleEventId('acme', 'u1', 'sample-plugin', 'article:42'));
    expect(ctx.tenantDb.calendarEventLink.rows).toEqual([]);
  });

  it('upsert A, upsert B, remove — applied in any order and twice — ends with no event and no row', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });
    await ctx.provider.record({ ...ref, op: 'upsert', event: { ...event, title: 'B' } });
    await ctx.provider.record({ ...ref, op: 'remove' });

    // Three jobs for one event, late and repeated: each applies the current state
    for (let i = 0; i < 3; i++) await ctx.provider.apply(ref);

    expect(ctx.google.putEvent).not.toHaveBeenCalled();
    expect(ctx.google.deleteEvent).toHaveBeenCalledTimes(1);
    expect(ctx.tenantDb.calendarEventLink.rows).toEqual([]);
  });

  it('a request recorded while apply was running stays PENDING and the job retries soon', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });
    ctx.google.putEvent.mockImplementationOnce(async () => {
      await ctx.provider.record({ ...ref, op: 'upsert', event: { ...event, title: 'Renamed meanwhile' } });
    });

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_RETRYABLE' });

    expect(link(ctx)).toMatchObject({ status: 'PENDING', desired: expect.objectContaining({ title: 'Renamed meanwhile' }) });
    await ctx.provider.apply(ref); // the retry
    expect(ctx.google.putEvent).toHaveBeenLastCalledWith('ya29.token', 'cal-1', expect.any(String), expect.objectContaining({ summary: 'Renamed meanwhile' }));
    expect(link(ctx).status).toBe('SYNCED');
  });

  it('an upsert recorded while a remove was running is applied by the retry', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'remove' });
    ctx.google.deleteEvent.mockImplementationOnce(async () => {
      await ctx.provider.record({ ...ref, op: 'upsert', event });
    });

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_RETRYABLE' });
    expect(link(ctx)).toMatchObject({ status: 'PENDING', desired: expect.objectContaining({ title: 'Published: Hello' }) });
  });

  it('a retryable Google error records the attempt and throws CALENDAR_RETRYABLE', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });
    ctx.google.putEvent.mockRejectedValueOnce(new GoogleApiError('RETRYABLE', 503, 'Saving the event: Google is busy (HTTP 503)'));

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_RETRYABLE' });
    expect(link(ctx)).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Saving the event: Google is busy (HTTP 503)' });
  });

  it('invalid_grant marks the connection NEEDS_RECONNECT, keeps the row PENDING, and throws CALENDAR_PERMANENT', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });
    ctx.google.putEvent.mockRejectedValue(new GoogleApiError('UNAUTHORIZED', 401, 'Saving the event: Google did not accept the credentials'));

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });

    // One retry with a fresh token first: the cached one may have been revoked early
    expect(ctx.connections.forgetAccessToken).toHaveBeenCalledWith('acme', 'u1');
    expect(ctx.google.putEvent).toHaveBeenCalledTimes(2);
    expect(ctx.connections.markNeedsReconnect).toHaveBeenCalledTimes(1);
    expect(ctx.connections.markNeedsReconnect).toHaveBeenCalledWith('acme', 'u1', expect.stringMatching(/revoked|expired/));
    expect(link(ctx).status).toBe('PENDING');
  });

  it('a dead grant reported by accessToken leaves the row PENDING', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });
    ctx.connections.accessToken.mockRejectedValueOnce(Object.assign(new Error('Google access was revoked'), { code: 'CALENDAR_PERMANENT' }));

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });
    expect(link(ctx).status).toBe('PENDING');
  });

  it('a deleted calendar marks NEEDS_RECONNECT with "The calendar was deleted in Google"', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });
    ctx.google.putEvent.mockRejectedValueOnce(new GoogleApiError('NOT_FOUND', 404, 'Saving the event: not found in Google'));
    ctx.google.calendarExists.mockResolvedValueOnce(false);

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });
    expect(ctx.google.calendarExists).toHaveBeenCalledWith('ya29.token', 'cal-1');
    expect(ctx.connections.markNeedsReconnect).toHaveBeenCalledWith('acme', 'u1', 'The calendar was deleted in Google');
    expect(link(ctx).status).toBe('PENDING');
  });

  it('a NOT_FOUND while the calendar still exists fails only that event, not the connection', async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });
    ctx.google.putEvent.mockRejectedValueOnce(new GoogleApiError('NOT_FOUND', 404, 'Saving the event: not found in Google'));

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });
    expect(ctx.connections.markNeedsReconnect).not.toHaveBeenCalled();
    expect(link(ctx)).toMatchObject({ status: 'FAILED', lastError: 'Saving the event: not found in Google' });
  });

  it("a rejected event is FAILED with Google's message", async () => {
    const ctx = setup();
    await ctx.provider.record({ ...ref, op: 'upsert', event });
    ctx.google.putEvent.mockRejectedValueOnce(new GoogleApiError('REJECTED', 400, 'Saving the event: Invalid start time.'));

    await expect(ctx.provider.apply(ref)).rejects.toMatchObject({ code: 'CALENDAR_PERMANENT' });
    expect(link(ctx)).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'Saving the event: Invalid start time.' });
    expect(ctx.connections.markNeedsReconnect).not.toHaveBeenCalled();
  });

  it("apply while the tenant is disabled or the user isn't CONNECTED leaves the row PENDING and calls nothing", async () => {
    const cases = [setup({ enabled: false }), setup({ usable: false }), setup({ connectionStatus: 'NEEDS_RECONNECT' })];
    for (const ctx of cases) {
      await ctx.provider.record({ ...ref, op: 'upsert', event });

      await expect(ctx.provider.apply(ref)).resolves.toBeUndefined();

      expect(ctx.connections.accessToken).not.toHaveBeenCalled();
      expect(ctx.google.putEvent).not.toHaveBeenCalled();
      expect(link(ctx).status).toBe('PENDING');
    }
  });

  it('pendingRefs lists only PENDING rows of CONNECTED users', async () => {
    const ctx = setup({
      links: [
        { id: 'l1', userId: 'u1', source: 's', key: 'a', status: 'PENDING' },
        { id: 'l2', userId: 'u1', source: 's', key: 'b', status: 'SYNCED' },
        { id: 'l3', userId: 'u2', source: 's', key: 'c', status: 'PENDING' },
      ],
    });
    ctx.tenantDb.calendarConnection.rows.push({ id: 'c2', userId: 'u2', status: 'NEEDS_RECONNECT' });

    await expect(ctx.provider.pendingRefs('acme')).resolves.toEqual([{ tenantSlug: 'acme', userId: 'u1', source: 's', key: 'a' }]);
    await expect(ctx.provider.pendingRefs('acme', 'u2')).resolves.toEqual([]);
  });

  it("connectionOf describes the user's own connection without tokens; none once disconnected", async () => {
    const ctx = setup();
    Object.assign(ctx.tenantDb.calendarConnection.rows[0], {
      accountEmail: 'ann@gmail.test', calendarName: 'Acme (via Acme Cloud)', lastError: null, refreshTokenEnc: 'v1:sealed',
    });

    const summary = await ctx.provider.connectionOf('acme', 'u1');

    expect(summary).toEqual({
      provider: 'Google', status: 'CONNECTED', accountEmail: 'ann@gmail.test', calendarName: 'Acme (via Acme Cloud)',
      lastError: null, manageAccessUrl: 'https://myaccount.google.com/connections',
      features: [{ key: 'calendar', name: 'Calendar', ready: true }, { key: 'meetings', name: 'Meet', ready: false }],
      activeMeetings: 2,
    });
    expect(ctx.connections.activeMeetingCount).toHaveBeenCalledWith('acme', 'u1');
    expect(JSON.stringify(summary)).not.toContain('v1:');
    await expect(ctx.provider.connectionOf('acme', 'u2')).resolves.toBeNull();
    await expect(setup({ connectionStatus: 'DISCONNECTED' }).provider.connectionOf('acme', 'u1')).resolves.toBeNull();
  });

  it('connectionOf lists only the features the tenant has on', async () => {
    const ctx = setup();
    Object.assign(ctx.tenantDb.calendarConnection.rows[0], { accountEmail: 'ann@gmail.test', calendarName: 'Acme', lastError: null });
    ctx.connections.featureStates.mockResolvedValueOnce({ calendar: 'ready', meet: 'off' });

    expect((await ctx.provider.connectionOf('acme', 'u1'))?.features).toEqual([{ key: 'calendar', name: 'Calendar', ready: true }]);
  });

  it('disconnect goes through the connections service', async () => {
    const ctx = setup();

    await ctx.provider.disconnect('acme', 'u1', { deleteCalendar: true });

    expect(ctx.connections.disconnect).toHaveBeenCalledWith('acme', 'u1', { deleteCalendar: true });
  });

  it('isConfigured follows the config; isEnabledFor asks the tenant setting', async () => {
    const ctx = setup({ enabled: false });

    expect(ctx.provider.isConfigured()).toBe(true);
    await expect(ctx.provider.isEnabledFor('acme')).resolves.toBe(false);
    expect(ctx.provider.pluginKey).toBe('integration');
  });
});
