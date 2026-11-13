import { UnrecoverableError } from 'bullmq';
import { calendarError } from '@saas/backend';
import { CalendarProcessor } from './calendar.processor';

const ref = { tenantSlug: 'acme', userId: 'u1', source: 'sample-plugin', key: 'article:42' };
const job = { id: 'j1', data: ref } as any;

function setup(apply: jest.Mock | null) {
  const moduleRef = {
    get: jest.fn(() => {
      if (!apply) throw new Error('Nest could not find CALENDAR_PROVIDER');
      return { apply };
    }),
  };
  return new CalendarProcessor(moduleRef as any);
}

describe('CalendarProcessor', () => {
  it("calls provider.apply with the job's ref", async () => {
    const apply = jest.fn(async () => undefined);
    await setup(apply).process(job);
    expect(apply).toHaveBeenCalledWith(ref);
  });

  it('a retryable error is rethrown (BullMQ retries it)', async () => {
    const error = calendarError('CALENDAR_RETRYABLE', 'rate limited');
    await expect(setup(jest.fn(async () => { throw error; })).process(job)).rejects.toBe(error);
  });

  it('a permanent error becomes UnrecoverableError (no retries)', async () => {
    const failing = setup(jest.fn(async () => { throw calendarError('CALENDAR_PERMANENT', 'needs reconnect'); }));
    await expect(failing.process(job)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('no provider → completes as a no-op', async () => {
    await expect(setup(null).process(job)).resolves.toBeUndefined();
  });
});
