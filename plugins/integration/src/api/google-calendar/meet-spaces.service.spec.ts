import { SystemEvents } from '@saas/backend';
import { GoogleApiError } from './google-api';
import { MeetSpacesService } from './meet-spaces.service';
import { fakeMeetDb, fakeMeetGoogle } from './meet.fakes';

const item = { id: 'item1', source: 'sample-plugin', key: 'article-review:42', title: 'Review', currentSpaceId: 'sp1', creatingSince: null };
const space = (overrides: Record<string, unknown> = {}) => ({
  id: 'sp1', itemId: 'item1', hostUserId: 'u1', hostAccountId: 'sub-ann', provider: 'google', spaceName: 'spaces/abc',
  joinUrl: 'https://meet.google.com/abc', access: 'TRUSTED', status: 'ACTIVE', lockState: 'OPEN', lastError: null, ...overrides,
});

function setup(spaces = [space()]) {
  const db = fakeMeetDb({ items: [item], spaces });
  const prisma = { getTenantClient: jest.fn(() => db) };
  const google = fakeMeetGoogle();
  const events = { emit: jest.fn() };
  const service = new MeetSpacesService(prisma as any, google as any, events as any);
  (service as any).sleep = jest.fn(async () => undefined);
  return { service, db, google, events };
}

describe('MeetSpacesService', () => {
  it('lockHostSpaces with a working token locks and orphans every ACTIVE space and emits ORPHANED', async () => {
    const ctx = setup([space(), space({ id: 'sp2', spaceName: 'spaces/def' }), space({ id: 'sp3', hostUserId: 'u2' })]);

    await ctx.service.lockHostSpaces('acme', 'u1', 'tok', 'The host disconnected Google');

    expect(ctx.google.setSpaceAccess.mock.calls).toEqual([['tok', 'spaces/abc', 'RESTRICTED'], ['tok', 'spaces/def', 'RESTRICTED']]);
    expect(ctx.google.endActiveConference).toHaveBeenCalledTimes(2);
    const mine = ctx.db.meetingSpace.rows.filter((r) => r.hostUserId === 'u1');
    expect(mine.map((r) => [r.status, r.lockState])).toEqual([['ORPHANED', 'LOCKED'], ['ORPHANED', 'LOCKED']]);
    expect(ctx.db.meetingSpace.rows.find((r) => r.id === 'sp3')).toMatchObject({ status: 'ACTIVE', lockState: 'OPEN' });
    expect(ctx.events.emit).toHaveBeenCalledWith(SystemEvents.INTEGRATION_MEETING_ORPHANED, expect.objectContaining({
      tenantSlug: 'acme', source: 'sample-plugin', key: 'article-review:42', hostUserId: 'u1', reason: 'The host disconnected Google',
    }));
  });

  it('lockHostSpaces in final mode retries 3 times and then marks FAILED; with no token it is FAILED at once', async () => {
    const busy = setup();
    busy.google.setSpaceAccess.mockRejectedValue(new GoogleApiError('RETRYABLE', 503, 'Changing who can join the meeting: Google is busy (HTTP 503)'));
    await busy.service.lockHostSpaces('acme', 'u1', 'tok', 'The host left the organization');
    expect(busy.google.setSpaceAccess).toHaveBeenCalledTimes(3);
    expect(busy.db.meetingSpace.rows[0]).toMatchObject({ status: 'ORPHANED', lockState: 'FAILED', lastError: expect.stringContaining('busy') });

    const tokenless = setup();
    await tokenless.service.lockHostSpaces('acme', 'u1', null, 'The host left the organization');
    expect(tokenless.google.setSpaceAccess).not.toHaveBeenCalled();
    expect(tokenless.db.meetingSpace.rows[0]).toMatchObject({ status: 'ORPHANED', lockState: 'FAILED' });
  });

  it('a final lock stops at once on an error that retrying will not change', async () => {
    const ctx = setup();
    ctx.google.setSpaceAccess.mockRejectedValue(new GoogleApiError('REJECTED', 403, 'Changing who can join the meeting: Google refused (HTTP 403)'));

    await ctx.service.lockHostSpaces('acme', 'u1', 'tok', 'The host left the organization');

    expect(ctx.google.setSpaceAccess).toHaveBeenCalledTimes(1);
    expect(ctx.db.meetingSpace.rows[0]).toMatchObject({ status: 'ORPHANED', lockState: 'FAILED', lastError: expect.stringContaining('refused') });
  });

  it("lockHostSpaces locks the host's spaces together and retries only the ones that failed", async () => {
    const ctx = setup([space(), space({ id: 'sp2', spaceName: 'spaces/def' }), space({ id: 'sp3', spaceName: 'spaces/ghi' })]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let busyOnce = true;
    ctx.google.setSpaceAccess.mockImplementation(async (_token: string, name: string) => {
      await gate;
      if (name === 'spaces/def' && busyOnce) {
        busyOnce = false;
        throw new GoogleApiError('RETRYABLE', 503, 'busy');
      }
    });

    const done = ctx.service.lockHostSpaces('acme', 'u1', 'tok', 'The host left the organization');
    await new Promise((resolve) => setImmediate(resolve));
    // All three are under way before any of them answers
    expect(ctx.google.setSpaceAccess).toHaveBeenCalledTimes(3);
    release();
    await done;

    expect(ctx.google.setSpaceAccess.mock.calls.map((call) => call[1])).toEqual(['spaces/abc', 'spaces/def', 'spaces/ghi', 'spaces/def']);
    expect((ctx.service as any).sleep.mock.calls).toEqual([[1_000]]);
    expect(ctx.db.meetingSpace.rows.map((r) => r.lockState)).toEqual(['LOCKED', 'LOCKED', 'LOCKED']);
  });

  it('lockHostSpaces starts no new round once about 5 s have gone by', async () => {
    const ctx = setup([space(), space({ id: 'sp2', spaceName: 'spaces/def' })]);
    ctx.google.setSpaceAccess.mockRejectedValue(new GoogleApiError('RETRYABLE', 0, 'could not reach Google (TimeoutError)'));
    // The first round took 6 s (e.g. Google hung until the request timeout)
    (ctx.service as any).now = jest.fn().mockReturnValueOnce(0).mockReturnValue(6_000);

    await ctx.service.lockHostSpaces('acme', 'u1', 'tok', 'The host left the organization');

    expect(ctx.google.setSpaceAccess).toHaveBeenCalledTimes(2);
    expect(ctx.db.meetingSpace.rows.map((r) => r.lockState)).toEqual(['FAILED', 'FAILED']);
  });

  it('lockHostSpaces also finishes PENDING locks of meetings already cancelled', async () => {
    const ctx = setup([space({ status: 'CANCELLED', lockState: 'PENDING' })]);

    await ctx.service.lockHostSpaces('acme', 'u1', 'tok', 'The host left the organization');

    expect(ctx.db.meetingSpace.rows[0]).toMatchObject({ status: 'CANCELLED', lockState: 'LOCKED' });
    expect(ctx.events.emit).not.toHaveBeenCalled();
  });

  it('lock in retry-later mode makes PENDING, once, when Google fails', async () => {
    const ctx = setup();
    ctx.google.endActiveConference.mockRejectedValueOnce(new GoogleApiError('RETRYABLE', 503, 'busy'));

    await expect(ctx.service.lock('acme', 'tok', space(), 'retry-later')).resolves.toBe('PENDING');
    expect(ctx.google.setSpaceAccess).toHaveBeenCalledTimes(1);
    expect(ctx.db.meetingSpace.rows[0]).toMatchObject({ lockState: 'PENDING', lastError: 'busy' });
  });

  it('retryPending locks the PENDING spaces of the same Google account and fails the others', async () => {
    const ctx = setup([
      space({ status: 'CANCELLED', lockState: 'PENDING' }),
      space({ id: 'sp2', status: 'ORPHANED', lockState: 'PENDING', hostAccountId: 'sub-old' }),
    ]);

    await expect(ctx.service.retryPending('acme', 'u1', 'tok', 'sub-ann')).resolves.toBe(1);

    expect(ctx.db.meetingSpace.rows.map((r) => r.lockState)).toEqual(['LOCKED', 'FAILED']);
  });
});
