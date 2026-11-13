import { JobsController } from './jobs.controller';

function fakeQueue(jobs: unknown[]) {
  return { getJobs: jest.fn(async () => jobs), getJobCounts: jest.fn(async () => ({})) };
}

const emailJob = {
  id: '1',
  name: 'send-email',
  attemptsMade: 1,
  data: {
    messageId: 'm1',
    tenantSlug: 'acme',
    envelope: { to: ['a@x'], subject: 'S', html: '<p>secret</p>', text: 'secret' },
  },
};

const webhookJob = { id: '2', name: 'deliver-webhook', attemptsMade: 0, data: { url: 'https://hook.test', payload: { a: 1 } } };

const calendarJob = { id: '3', name: 'sync-calendar-event', attemptsMade: 0, data: { tenantSlug: 'acme', userId: 'u1', source: 'sample-plugin', key: 'article:1' } };

describe('JobsController.getJobs', () => {
  const controller = new JobsController(fakeQueue([emailJob]) as any, fakeQueue([webhookJob]) as any, fakeQueue([]) as any, fakeQueue([calendarJob]) as any);

  it('email jobs are listed without html or text', async () => {
    const [job] = (await controller.getJobs('email', 'failed')) as any[];

    expect(job.data.envelope.html).toBeUndefined();
    expect(job.data.envelope.text).toBeUndefined();
    expect(job.data.envelope.subject).toBe('S');
    expect(job.data.messageId).toBe('m1');
  });

  it('webhook jobs keep their data', async () => {
    const [job] = (await controller.getJobs('webhook', 'failed')) as any[];

    expect(job.data).toEqual({ url: 'https://hook.test', payload: { a: 1 } });
  });

  it('calendar jobs are listed, and the calendar queue is in the stats', async () => {
    const [job] = (await controller.getJobs('calendar', 'waiting')) as any[];

    expect(job.data).toEqual(calendarJob.data);
    expect(await controller.getStats()).toHaveProperty('calendar');
  });
});
