import { EmailProcessor, type EmailJob } from './email.processor';

const envelope = {
  from: { name: 'Acme', address: 'no-reply@saas.test' },
  to: ['a@acme.test'],
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
};

function setup(send: jest.Mock) {
  const tenantUpdate = jest.fn(async () => ({}));
  const publicUpdate = jest.fn(async () => ({}));
  const tenantUpdateMany = jest.fn(async () => ({ count: 1 }));
  const prisma = {
    emailMessage: { update: publicUpdate, updateMany: jest.fn() },
    getTenantClient: jest.fn(() => ({ emailMessage: { update: tenantUpdate, updateMany: tenantUpdateMany } })),
  };
  const processor = new EmailProcessor(prisma as any, { current: { send } });
  return { processor, prisma, tenantUpdate, publicUpdate, tenantUpdateMany };
}

const job = (data: Partial<EmailJob> = {}, attemptsMade = 0, attempts = 3) =>
  ({ id: 'm1', data: { messageId: 'm1', tenantSlug: 'acme', envelope, ...data }, attemptsMade, opts: { attempts } }) as any;

describe('EmailProcessor', () => {
  it('marks SENT with provider message id', async () => {
    const send = jest.fn(async () => ({ messageId: '<id@smtp>' }));
    const { processor, tenantUpdate } = setup(send);

    await processor.process(job());

    expect(send).toHaveBeenCalledWith(envelope);
    expect(tenantUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'SENT', attempts: { increment: 1 }, sentAt: expect.any(Date), providerMessageId: '<id@smtp>', lastError: null },
    });
  });

  it('records the error and rethrows on a failed attempt', async () => {
    const send = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { processor, tenantUpdate } = setup(send);

    await expect(processor.process(job({}, 0, 3))).rejects.toThrow('ECONNREFUSED');

    expect(tenantUpdate).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { attempts: { increment: 1 }, lastError: 'ECONNREFUSED' } });
  });

  it('marks FAILED after the last attempt', async () => {
    const send = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { processor, tenantUpdate } = setup(send);

    await expect(processor.process(job({}, 2, 3))).rejects.toThrow('ECONNREFUSED');

    expect(tenantUpdate).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { attempts: { increment: 1 }, lastError: 'ECONNREFUSED', status: 'FAILED' } });
  });

  it('updates the row in the right schema', async () => {
    const send = jest.fn(async () => ({}));
    const { processor, publicUpdate, tenantUpdate, prisma } = setup(send);

    await processor.process(job({ tenantSlug: null }));

    expect(prisma.getTenantClient).not.toHaveBeenCalled();
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(publicUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' } }));
  });

  it('a job that fails outside process() (stalled too often) still marks its email FAILED', async () => {
    const { processor, tenantUpdateMany } = setup(jest.fn());
    const stalled = { ...job(), isFailed: jest.fn(async () => true) };

    await processor.onFailed(stalled, new Error('job stalled more than allowable limit'));

    expect(tenantUpdateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'QUEUED' },
      data: { status: 'FAILED', lastError: 'job stalled more than allowable limit' },
    });
  });

  it('a failed attempt that will be retried leaves the email alone', async () => {
    const { processor, tenantUpdateMany } = setup(jest.fn());

    await processor.onFailed({ ...job(), isFailed: jest.fn(async () => false) }, new Error('ECONNREFUSED'));

    expect(tenantUpdateMany).not.toHaveBeenCalled();
  });

  it('a failure to record SENT does not resend the email', async () => {
    const send = jest.fn(async () => ({ messageId: 'x' }));
    const { processor, tenantUpdate } = setup(send);
    tenantUpdate.mockRejectedValueOnce(new Error('db down'));

    await expect(processor.process(job())).resolves.toBeUndefined();
  });
});
