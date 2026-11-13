import { EmailRetentionJob } from './email-retention.job';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-21T03:00:00Z');

function setup(failing: string[] = []) {
  const deletes: Array<{ schema: string; where: any }> = [];
  const updates: Array<{ schema: string; where: any; data: any }> = [];
  const messagesFor = (schema: string) => ({
    deleteMany: jest.fn(async ({ where }: any) => {
      if (failing.includes(schema)) throw new Error(`relation "${schema}.email_message" does not exist`);
      deletes.push({ schema, where });
      return { count: 2 };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (failing.includes(schema)) throw new Error(`relation "${schema}.email_message" does not exist`);
      updates.push({ schema, where, data });
      return { count: 1 };
    }),
  });
  const prisma = {
    emailMessage: messagesFor('public'),
    tenant: { findMany: jest.fn(async () => [{ slug: 'acme' }, { slug: 'beta' }, { slug: 'gamma' }]) },
    getTenantClient: jest.fn((slug: string) => ({ emailMessage: messagesFor(slug) })),
  };
  const job = new EmailRetentionJob(prisma as any, { retentionDays: 90 } as any);
  jest.spyOn((job as any).logger, 'warn').mockImplementation(() => undefined);
  return { job, deletes, updates, prisma };
}

describe('EmailRetentionJob', () => {
  it('deletes only rows older than the retention window', async () => {
    const { job, deletes } = setup();

    await job.run(NOW);

    expect(deletes[0].where).toEqual({ createdAt: { lt: new Date(NOW.getTime() - 90 * DAY) } });
  });

  it('covers public and every tenant, whatever its status', async () => {
    const { job, deletes, prisma } = setup();

    const result = await job.run(NOW);

    expect(deletes.map((d) => d.schema)).toEqual(['public', 'acme', 'beta', 'gamma']);
    expect(prisma.tenant.findMany).toHaveBeenCalledWith({ select: { slug: true } });
    expect(result).toEqual({ deleted: 8, errors: [] });
  });

  it('marks emails stuck in QUEUED for over an hour as FAILED, everywhere', async () => {
    const { job, updates } = setup(['beta']);

    const result = await job.sweepStuck(NOW);

    expect(updates.map((u) => u.schema)).toEqual(['public', 'acme', 'gamma']);
    expect(updates[0].where).toEqual({ status: 'QUEUED', queuedAt: { lt: new Date(NOW.getTime() - 60 * 60 * 1000) } });
    expect(updates[0].data).toEqual({ status: 'FAILED', lastError: expect.stringMatching(/lost from the queue/) });
    expect(result).toEqual({ marked: 3, errors: [{ tenantSlug: 'beta', error: expect.any(String) }] });
  });

  it('a failing tenant does not stop the others', async () => {
    const { job, deletes } = setup(['beta']);

    const result = await job.run(NOW);

    expect(deletes.map((d) => d.schema)).toEqual(['public', 'acme', 'gamma']);
    expect(result.errors).toEqual([{ tenantSlug: 'beta', error: 'relation "beta.email_message" does not exist' }]);
  });
});
