import { emailSettingsSchema, emailLogQuerySchema, EmailAdminController, EmailPlatformController } from './email-admin.controller';

describe('email settings validation', () => {
  it('accepts a sender name and reply-to, and empty values as "use the default"', () => {
    expect(emailSettingsSchema.parse({ senderName: ' Acme Billing ', replyTo: 'billing@acme.test' })).toEqual({ senderName: 'Acme Billing', replyTo: 'billing@acme.test' });
    expect(emailSettingsSchema.parse({ senderName: '', replyTo: null })).toEqual({ senderName: null, replyTo: null });
  });

  it.each(['Acme\r\nBcc: victim@x.test', 'Acme "Ops"', 'Acme <ops@x.test>', 'x'.repeat(101)])('rejects a sender name like %j', (senderName) => {
    expect(emailSettingsSchema.safeParse({ senderName }).success).toBe(false);
  });

  it.each(['not-an-email', 'a@b', 'a@b.test\r\nBcc: v@x.test', 'a b@c.test'])('rejects a malformed reply-to %j', (replyTo) => {
    expect(emailSettingsSchema.safeParse({ replyTo }).success).toBe(false);
  });

  it('log query: numbers from the query string, limit capped at 100, unknown status refused', () => {
    expect(emailLogQuerySchema.parse({ page: '2', limit: '500', status: 'FAILED' })).toEqual({ page: 2, limit: 100, status: 'FAILED' });
    expect(emailLogQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(emailLogQuerySchema.safeParse({ status: 'LOST' }).success).toBe(false);
  });

  it('log query: origin (workspace log) and tenant (platform log) filters', () => {
    expect(emailLogQuerySchema.parse({ origin: 'platform', tenant: 'acme' })).toEqual({ page: 1, limit: 20, origin: 'platform', tenant: 'acme' });
    expect(emailLogQuerySchema.safeParse({ origin: 'elsewhere' }).success).toBe(false);
  });
});

describe('email log controllers', () => {
  const log = {
    getSettings: jest.fn(async () => ({})),
    updateSettings: jest.fn(async () => ({})),
    list: jest.fn(async () => ({ data: [], meta: {} })),
    get: jest.fn(async () => ({})),
    retry: jest.fn(async () => ({})),
  };
  const req = { tenant: { slug: 'acme' } } as any;

  it("tenant routes work on the caller's tenant", async () => {
    const controller = new EmailAdminController(log as any);

    await controller.list(req, { page: 1, limit: 20 });
    await controller.retry(req, 'm1');

    expect(log.list).toHaveBeenCalledWith('acme', { page: 1, limit: 20 });
    expect(log.retry).toHaveBeenCalledWith('acme', 'm1');
  });

  it('platform routes work on the public schema', async () => {
    const controller = new EmailPlatformController(log as any);

    await controller.list({ page: 1, limit: 20 });
    await controller.get('p1');
    await controller.retry('p1');

    expect(log.list).toHaveBeenLastCalledWith(null, { page: 1, limit: 20 });
    expect(log.get).toHaveBeenLastCalledWith(null, 'p1');
    expect(log.retry).toHaveBeenLastCalledWith(null, 'p1');
  });
});
