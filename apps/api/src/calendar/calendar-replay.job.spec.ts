import { CalendarReplayJob } from './calendar-replay.job';

describe('CalendarReplayJob', () => {
  it('resyncs every tenant; one failing tenant does not stop the others', async () => {
    const prisma = { tenant: { findMany: jest.fn(async () => [{ slug: 'acme' }, { slug: 'beta' }, { slug: 'gamma' }]) } };
    const calendarSync = {
      resync: jest.fn(async (slug: string) => {
        if (slug === 'beta') throw new Error('schema missing');
        return 2;
      }),
    };
    const job = new CalendarReplayJob(prisma as any, calendarSync as any);
    jest.spyOn((job as any).logger, 'warn').mockImplementation(() => undefined);

    const result = await job.run();

    expect(calendarSync.resync.mock.calls.map(([slug]) => slug)).toEqual(['acme', 'beta', 'gamma']);
    expect(result).toEqual({ queued: 4, errors: [{ tenantSlug: 'beta', error: 'schema missing' }] });
  });
});
