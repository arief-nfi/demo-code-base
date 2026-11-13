import { MeetingLockJob } from './meeting-lock.job';

describe('MeetingLockJob', () => {
  it("retries pending locks for every tenant; one failing tenant doesn't stop the others", async () => {
    const prisma = { tenant: { findMany: jest.fn(async () => [{ slug: 'acme' }, { slug: 'beta' }, { slug: 'gamma' }]) } };
    const meetings = {
      retryPendingLocks: jest.fn(async (slug: string) => {
        if (slug === 'beta') throw new Error('schema missing');
        return 3;
      }),
    };
    const job = new MeetingLockJob(prisma as any, meetings as any);
    jest.spyOn((job as any).logger, 'warn').mockImplementation(() => undefined);

    const result = await job.run();

    expect(meetings.retryPendingLocks.mock.calls.map(([slug]) => slug)).toEqual(['acme', 'beta', 'gamma']);
    expect(result).toEqual({ locked: 6, errors: [{ tenantSlug: 'beta', error: 'schema missing' }] });
  });
});
