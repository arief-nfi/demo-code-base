import { SystemEvents } from '@saas/backend';
import { GoogleApiError } from './google-api';
import { GoogleMeetProvider } from './google-meet.provider';
import { MeetSpacesService } from './meet-spaces.service';
import { fakeMeetDb, fakeMeetGoogle } from './meet.fakes';

const MEET = 'https://www.googleapis.com/auth/meetings.space.created';
const CAL = 'https://www.googleapis.com/auth/calendar.app.created';
const conn = (userId: string, overrides: Record<string, unknown> = {}) => ({
  id: `c-${userId}`, userId, status: 'CONNECTED', externalAccountId: `sub-${userId}`, scopes: `openid email ${CAL} ${MEET}`, ...overrides,
});
const input = { tenantSlug: 'acme', hostUserId: 'u1', source: 'sample-plugin', key: 'article-review:42', title: 'Review: Hello' };
const ref = { tenantSlug: 'acme', source: 'sample-plugin', key: 'article-review:42' };
const config = { clientId: 'c', clientSecret: 's', encryptionKey: 'k', redirectUri: 'r', appName: 'Acme', configured: true };

function setup(seed: Parameters<typeof fakeMeetDb>[0] = { connections: [conn('u1'), conn('u2')] }, opts: { realSleep?: boolean } = {}) {
  const tenants: Record<string, ReturnType<typeof fakeMeetDb>> = { acme: fakeMeetDb(seed), beta: fakeMeetDb({ connections: [conn('u1')] }) };
  const prisma = { getTenantClient: jest.fn((slug: string) => tenants[slug]) };
  const google = fakeMeetGoogle();
  const events = { emit: jest.fn() };
  const connections = {
    googleAccessToken: jest.fn(async (_t: string, userId: string, _scope: string, _accountId?: string) => ({ token: `tok-${userId}`, accountId: `sub-${userId}` })),
    featureSwitches: jest.fn(async () => ({ calendar: true, meet: true, meetDefaultAccess: 'TRUSTED' })),
    isMeetEnabled: jest.fn(async () => true),
    markNeedsReconnect: jest.fn(async () => undefined),
    forgetAccessToken: jest.fn(),
  };
  const spaces = new MeetSpacesService(prisma as any, google as any, events as any);
  (spaces as any).sleep = jest.fn(async () => undefined);
  const platform = { ...config };
  const provider = new GoogleMeetProvider(prisma as any, google as any, platform, connections as any, spaces, events as any);
  if (!opts.realSleep) (provider as any).sleep = jest.fn(async () => undefined);
  (provider as any).logger.warn = jest.fn();
  return { provider, db: tenants.acme, google, events, connections, platform };
}

const cancelledEvents = (ctx: ReturnType<typeof setup>) =>
  ctx.events.emit.mock.calls.filter(([event]) => event === SystemEvents.INTEGRATION_MEETING_CANCELLED).map(([, payload]) => payload);

describe('GoogleMeetProvider', () => {
  it('create returns created with the meetingUri and stores the space name, never a meeting code', async () => {
    const ctx = setup();

    const result = await ctx.provider.create(input);

    expect(result).toEqual({ status: 'created', meeting: { provider: 'google-meet', joinUrl: 'https://meet.google.com/aaa-bbbb-cc1', hostUserId: 'u1', access: 'TRUSTED', status: 'ACTIVE' } });
    expect(ctx.google.createSpace).toHaveBeenCalledWith('tok-u1', 'TRUSTED');
    const [row] = ctx.db.meetingSpace.rows;
    expect(row).toMatchObject({ hostUserId: 'u1', hostAccountId: 'sub-u1', spaceName: 'spaces/space1', joinUrl: 'https://meet.google.com/aaa-bbbb-cc1', status: 'ACTIVE', lockState: 'OPEN' });
    expect(JSON.stringify(row)).not.toContain('meetingCode');
    expect(ctx.db.meetingItem.rows[0]).toMatchObject({ source: 'sample-plugin', key: 'article-review:42', title: 'Review: Hello', currentSpaceId: row.id, creatingSince: null });
    expect(ctx.events.emit).toHaveBeenCalledWith(SystemEvents.INTEGRATION_MEETING_CREATED, expect.objectContaining({ source: 'sample-plugin', key: 'article-review:42', hostUserId: 'u1' }));
  });

  it('create again for the same item and host returns existing with the same link, and applies a changed access', async () => {
    const ctx = setup();
    await ctx.provider.create(input);

    const again = await ctx.provider.create(input);
    const opened = await ctx.provider.create({ ...input, access: 'OPEN' });

    expect(again).toMatchObject({ status: 'existing', meeting: { joinUrl: 'https://meet.google.com/aaa-bbbb-cc1' } });
    expect(opened).toMatchObject({ status: 'existing', meeting: { joinUrl: 'https://meet.google.com/aaa-bbbb-cc1', access: 'OPEN' } });
    expect(ctx.google.createSpace).toHaveBeenCalledTimes(1);
    expect(ctx.google.setSpaceAccess).toHaveBeenCalledWith('tok-u1', 'spaces/space1', 'OPEN');
  });

  it('two simultaneous creates for one item make one space and both get the same joinUrl', async () => {
    const ctx = setup(undefined, { realSleep: true });
    const create = ctx.google.createSpace.getMockImplementation()!;
    ctx.google.createSpace.mockImplementation(async (token, access) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return create(token, access);
    });

    const [a, b] = await Promise.all([ctx.provider.create(input), ctx.provider.create(input)]);

    expect(ctx.google.createSpace).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual(['created', 'existing']);
    expect((a as any).meeting.joinUrl).toBe((b as any).meeting.joinUrl);
  });

  it('a claim older than 60 seconds is taken over', async () => {
    const ctx = setup({ connections: [conn('u1')], items: [{ id: 'item1', source: 'sample-plugin', key: 'article-review:42', currentSpaceId: null, creatingSince: new Date(Date.now() - 120_000) }] });

    await expect(ctx.provider.create(input)).resolves.toMatchObject({ status: 'created' });
    expect(ctx.db.meetingItem.rows[0].creatingSince).toBeNull();
  });

  it('a fresh claim held by another request gives unavailable when it never finishes', async () => {
    const ctx = setup({ connections: [conn('u1')], items: [{ id: 'item1', source: 'sample-plugin', key: 'article-review:42', currentSpaceId: null, creatingSince: new Date() }] });

    await expect(ctx.provider.create(input)).resolves.toEqual({ status: 'unavailable', message: 'This meeting is being created; try again.' });
    expect(ctx.google.createSpace).not.toHaveBeenCalled();
  });

  it('a host change locks the old space (RESTRICTED + end conference), marks it CANCELLED and creates a new one', async () => {
    const ctx = setup();
    await ctx.provider.create({ ...input, hostUserId: 'u2' });

    const result = await ctx.provider.create(input);

    expect(result).toMatchObject({ status: 'created', meeting: { hostUserId: 'u1', joinUrl: 'https://meet.google.com/aaa-bbbb-cc2' } });
    expect(ctx.google.setSpaceAccess).toHaveBeenCalledWith('tok-u2', 'spaces/space1', 'RESTRICTED');
    expect(ctx.google.endActiveConference).toHaveBeenCalledWith('tok-u2', 'spaces/space1');
    expect(ctx.db.meetingSpace.rows.map((r) => [r.hostUserId, r.status, r.lockState])).toEqual([['u2', 'CANCELLED', 'LOCKED'], ['u1', 'ACTIVE', 'OPEN']]);
  });

  it('a host change says the old meeting was replaced; a cancel says it was not', async () => {
    const ctx = setup();
    await ctx.provider.create({ ...input, hostUserId: 'u2' });
    await ctx.provider.create(input);
    await ctx.provider.cancel(ref);

    expect(cancelledEvents(ctx)).toEqual([
      expect.objectContaining({ hostUserId: 'u2', replaced: true }),
      expect.objectContaining({ hostUserId: 'u1', replaced: false }),
    ]);
  });

  it("a platform sign-in Google refuses gives failed and leaves the connection alone; a grant that died while creating gives not-connected", async () => {
    const platform = setup();
    platform.connections.googleAccessToken.mockRejectedValue(
      Object.assign(new Error('Refreshing the access token: Google rejected the OAuth client: check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'), { code: 'CALENDAR_PERMANENT' }),
    );
    await expect(platform.provider.create(input)).resolves.toEqual({
      status: 'failed',
      message: "Google didn't accept this platform's sign-in. Tell your platform administrator.",
    });
    expect(platform.connections.markNeedsReconnect).not.toHaveBeenCalled();
    expect(platform.db.calendarConnection.rows[0].status).toBe('CONNECTED');

    const revoked = setup();
    revoked.connections.googleAccessToken.mockImplementation(async () => {
      revoked.db.calendarConnection.rows[0].status = 'NEEDS_RECONNECT'; // what the token refresh does on invalid_grant
      throw Object.assign(new Error('Google access was revoked or has expired'), { code: 'CALENDAR_PERMANENT' });
    });
    await expect(revoked.provider.create(input)).resolves.toEqual({ status: 'not-connected' });
  });

  it('not-connected for no or broken connections; needs-permission without the Meet scope; no Google call', async () => {
    for (const [connections, status] of [
      [[], 'not-connected'],
      [[conn('u1', { status: 'NEEDS_RECONNECT' })], 'not-connected'],
      [[conn('u1', { status: 'DISCONNECTED' })], 'not-connected'],
      [[conn('u1', { scopes: `openid email ${CAL}` })], 'needs-permission'],
    ] as const) {
      const ctx = setup({ connections: [...connections] });
      await expect(ctx.provider.create(input)).resolves.toEqual({ status });
      expect(ctx.google.createSpace).not.toHaveBeenCalled();
    }
  });

  it("RETRYABLE twice gives unavailable; REJECTED gives failed with Google's message; the claim is released either way", async () => {
    const busy = setup();
    busy.google.createSpace.mockRejectedValue(new GoogleApiError('RETRYABLE', 503, 'Creating the meeting: Google is busy (HTTP 503)'));
    await expect(busy.provider.create(input)).resolves.toMatchObject({ status: 'unavailable' });
    expect(busy.google.createSpace).toHaveBeenCalledTimes(2);
    expect(busy.db.meetingItem.rows[0].creatingSince).toBeNull();

    const refused = setup();
    refused.google.createSpace.mockRejectedValue(new GoogleApiError('REJECTED', 400, 'Creating the meeting: Invalid access type'));
    await expect(refused.provider.create(input)).resolves.toEqual({ status: 'failed', message: 'Creating the meeting: Invalid access type' });
    expect(refused.db.meetingItem.rows[0].creatingSince).toBeNull();
    expect(refused.db.meetingSpace.rows).toEqual([]);
  });

  it('a revoked grant while creating marks the connection NEEDS_RECONNECT and gives not-connected', async () => {
    const ctx = setup();
    ctx.google.createSpace.mockRejectedValue(new GoogleApiError('UNAUTHORIZED', 401, 'Creating the meeting: Google did not accept the credentials'));

    await expect(ctx.provider.create(input)).resolves.toEqual({ status: 'not-connected' });
    expect(ctx.connections.forgetAccessToken).toHaveBeenCalledWith('acme', 'u1');
    expect(ctx.connections.markNeedsReconnect).toHaveBeenCalledWith('acme', 'u1', 'Google access was revoked or has expired');
  });

  it('cancel locks and reports locked true; with a dead token it is PENDING and locked false', async () => {
    const ok = setup();
    await ok.provider.create(input);
    await expect(ok.provider.cancel(ref)).resolves.toEqual({ status: 'cancelled', locked: true });
    expect(ok.db.meetingSpace.rows[0]).toMatchObject({ status: 'CANCELLED', lockState: 'LOCKED' });
    expect(ok.events.emit).toHaveBeenCalledWith(SystemEvents.INTEGRATION_MEETING_CANCELLED, expect.objectContaining({ key: 'article-review:42' }));
    await expect(ok.provider.get(ref)).resolves.toMatchObject({ status: 'CANCELLED' });

    const dead = setup();
    await dead.provider.create(input);
    dead.connections.googleAccessToken.mockRejectedValue(Object.assign(new Error('Google access was revoked'), { code: 'CALENDAR_PERMANENT' }));
    await expect(dead.provider.cancel(ref)).resolves.toEqual({ status: 'cancelled', locked: false });
    expect(dead.db.meetingSpace.rows[0]).toMatchObject({ status: 'CANCELLED', lockState: 'PENDING' });
  });

  it('cancel records the meeting as cancelled, lock pending, before it asks Google', async () => {
    const ctx = setup();
    await ctx.provider.create(input);
    let release!: () => void;
    ctx.google.setSpaceAccess.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    const cancelling = ctx.provider.cancel(ref);
    await new Promise((resolve) => setImmediate(resolve));
    // Google hasn't answered yet: an answer given now ("cancelled, not locked yet") is already true
    expect(ctx.db.meetingSpace.rows[0]).toMatchObject({ status: 'CANCELLED', lockState: 'PENDING' });
    release();

    await expect(cancelling).resolves.toEqual({ status: 'cancelled', locked: true });
    expect(ctx.db.meetingSpace.rows[0]).toMatchObject({ status: 'CANCELLED', lockState: 'LOCKED' });
  });

  it('cancel of an orphaned meeting calls nothing and keeps its lock state', async () => {
    const ctx = setup({
      connections: [conn('u1')],
      items: [{ id: 'item1', source: 'sample-plugin', key: 'article-review:42', currentSpaceId: 'sp1', creatingSince: null }],
      spaces: [{ id: 'sp1', itemId: 'item1', hostUserId: 'u1', hostAccountId: 'sub-u1', spaceName: 'spaces/x', joinUrl: 'https://meet.google.com/x', access: 'TRUSTED', status: 'ORPHANED', lockState: 'FAILED' }],
    });

    await expect(ctx.provider.cancel(ref)).resolves.toEqual({ status: 'cancelled', locked: false });
    expect(ctx.google.setSpaceAccess).not.toHaveBeenCalled();
    expect(ctx.db.meetingSpace.rows[0]).toMatchObject({ status: 'CANCELLED', lockState: 'FAILED' });
  });

  it('without Google credentials, cancel records the meeting cancelled, lock pending, and asks neither for a token nor Google', async () => {
    const ctx = setup();
    await ctx.provider.create(input);
    ctx.connections.googleAccessToken.mockClear();
    ctx.platform.configured = false;

    await expect(ctx.provider.cancel(ref)).resolves.toEqual({ status: 'cancelled', locked: false });

    expect(ctx.connections.googleAccessToken).not.toHaveBeenCalled();
    expect(ctx.google.setSpaceAccess).not.toHaveBeenCalled();
    expect(ctx.db.meetingSpace.rows[0]).toMatchObject({ status: 'CANCELLED', lockState: 'PENDING' });
    await expect(ctx.provider.get(ref)).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('cancel waits for a create in progress and cancels the meeting it makes', async () => {
    const ctx = setup(undefined, { realSleep: true });
    const create = ctx.google.createSpace.getMockImplementation()!;
    ctx.google.createSpace.mockImplementation(async (token, access) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return create(token, access);
    });

    const creating = ctx.provider.create(input);
    await new Promise((resolve) => setTimeout(resolve, 20)); // the create holds the item; Google hasn't answered
    const cancelled = await ctx.provider.cancel(ref);

    await expect(creating).resolves.toMatchObject({ status: 'created' });
    expect(cancelled).toEqual({ status: 'cancelled', locked: true });
    expect(ctx.db.meetingSpace.rows).toEqual([expect.objectContaining({ status: 'CANCELLED', lockState: 'LOCKED' })]);
    expect(ctx.db.meetingItem.rows[0].creatingSince).toBeNull();
  });

  it("another tenant's key is not-found", async () => {
    const ctx = setup();
    await ctx.provider.create(input);

    await expect(ctx.provider.get({ ...ref, tenantSlug: 'beta' })).resolves.toBeNull();
    await expect(ctx.provider.cancel({ ...ref, tenantSlug: 'beta' })).resolves.toEqual({ status: 'not-found', locked: false });
    expect(ctx.db.meetingSpace.rows[0].status).toBe('ACTIVE');
  });

  it('retryPendingLocks locks PENDING spaces of reconnected hosts and fails those whose Google account changed', async () => {
    const pending = (id: string, hostUserId: string, hostAccountId: string) => ({
      id, itemId: 'item1', hostUserId, hostAccountId, spaceName: `spaces/${id}`, joinUrl: 'x', access: 'TRUSTED', status: 'CANCELLED', lockState: 'PENDING',
    });
    const ctx = setup({
      connections: [conn('u1'), conn('u2'), conn('u3', { status: 'NEEDS_RECONNECT' })],
      items: [{ id: 'item1', source: 's', key: 'k', currentSpaceId: null, creatingSince: null }],
      spaces: [pending('a', 'u1', 'sub-u1'), pending('b', 'u2', 'sub-old'), pending('c', 'u3', 'sub-u3'), pending('d', 'u4', 'sub-u4')],
    });

    await expect(ctx.provider.retryPendingLocks('acme')).resolves.toBe(1);

    expect(ctx.db.meetingSpace.rows.map((r) => [r.id, r.lockState])).toEqual([['a', 'LOCKED'], ['b', 'FAILED'], ['c', 'PENDING'], ['d', 'FAILED']]);
  });
});
