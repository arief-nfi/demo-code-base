import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmailDefinitionsRegistry } from './definitions-registry';
import { CoreEmails } from './definitions/core.emails';
import { EmailLogService } from './email-log.service';

type Row = Record<string, any>;

function fakeMessages(rows: Row[]) {
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'lt' in v ? row[k] < v.lt
        : v && typeof v === 'object' && 'gte' in v ? row[k] >= v.gte
          : v && typeof v === 'object' && 'in' in v ? v.in.includes(row[k]) : row[k] === v);
  return {
    rows,
    findMany: jest.fn(async ({ where, select, skip = 0, take = 1000 }: Row) =>
      rows
        .filter((r) => matches(r, where))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(skip, skip + take)
        .map((r) => (select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, r[k]])) : r))),
    count: jest.fn(async ({ where }: Row) => rows.filter((r) => matches(r, where)).length),
    findUnique: jest.fn(async ({ where }: Row) => rows.find((r) => r.id === where.id) ?? null),
    findFirst: jest.fn(async ({ where }: Row) => rows.find((r) => matches(r, where)) ?? null),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
}

const row = (overrides: Row = {}): Row => ({
  id: 'm1', templateKey: 'core.password-reset', to: ['a@acme.test'], from: '"Acme" <no-reply@saas.test>', replyTo: null,
  subject: 'Hi', html: '<p>secret html</p>', text: 'secret text', status: 'FAILED', redacted: false, attempts: 3,
  createdAt: new Date('2026-10-20T10:00:00Z'), ...overrides,
});

function setup(tenantRows: Row[] = [], publicRows: Row[] = [], opts: { tenantCreatedAt?: Date } = {}) {
  const tenantMessages = fakeMessages(tenantRows);
  const publicMessages = fakeMessages(publicRows);
  const config = { id: 'c1', emailSenderName: null as string | null, emailReplyTo: null as string | null };
  const tenantConfig = {
    findFirst: jest.fn(async () => config),
    update: jest.fn(async ({ data }: Row) => Object.assign(config, data)),
  };
  const prisma = {
    emailMessage: publicMessages,
    tenant: { findUnique: jest.fn(async () => ({ id: 't1', slug: 'acme', name: 'Acme Corp', createdAt: opts.tenantCreatedAt ?? new Date('2026-01-01T00:00:00Z') })) },
    getTenantClient: jest.fn(() => ({ emailMessage: tenantMessages, tenantConfig })),
  };
  const email = { enqueueMessage: jest.fn(async (id: string) => ({ messageId: id, status: 'QUEUED' })) };
  const registry = new EmailDefinitionsRegistry(CoreEmails, {});
  return { service: new EmailLogService(prisma as any, email as any, registry), tenantMessages, publicMessages, email, prisma };
}

describe('EmailLogService', () => {
  it('settings round-trip', async () => {
    const { service } = setup();

    expect(await service.getSettings('acme')).toEqual({ senderName: null, replyTo: null, defaultSenderName: 'Acme Corp' });
    await service.updateSettings('acme', { senderName: 'Acme Billing', replyTo: 'billing@acme.test' });
    expect(await service.getSettings('acme')).toEqual({ senderName: 'Acme Billing', replyTo: 'billing@acme.test', defaultSenderName: 'Acme Corp' });
    await service.updateSettings('acme', { senderName: null });
    expect(await service.getSettings('acme')).toMatchObject({ senderName: null, replyTo: 'billing@acme.test' });
  });

  it('list omits html and text and paginates', async () => {
    const rows = [1, 2, 3].map((n) => row({ id: `m${n}`, createdAt: new Date(2026, 9, n) }));
    const { service } = setup(rows);

    const page = await service.list('acme', { page: 2, limit: 2 });

    expect(page.meta).toEqual({ total: 3, page: 2, limit: 2, totalPages: 2 });
    expect(page.data.map((r: Row) => r.id)).toEqual(['m1']);
    expect(page.data[0]).not.toHaveProperty('html');
    expect(page.data[0]).not.toHaveProperty('text');
    expect(page.data[0]).toMatchObject({ subject: 'Hi', status: 'FAILED', to: ['a@acme.test'] });
  });

  it('filters by status and template', async () => {
    const { service } = setup([row({ id: 'a' }), row({ id: 'b', status: 'SENT' }), row({ id: 'c', templateKey: 'sample-plugin.x' })]);

    const failedResets = await service.list('acme', { status: 'FAILED', template: 'core.password-reset', page: 1, limit: 20 });

    expect(failedResets.data.map((r: Row) => r.id)).toEqual(['a']);
  });

  it('get returns the full row, or 404', async () => {
    const { service } = setup([row()]);
    await expect(service.get('acme', 'm1')).resolves.toMatchObject({ html: '<p>secret html</p>' });
    await expect(service.get('acme', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('retry re-queues a failed message once', async () => {
    const { service, email, tenantMessages } = setup([row()]);

    await service.retry('acme', 'm1');

    expect(tenantMessages.rows[0]).toMatchObject({ status: 'QUEUED', lastError: null, queuedAt: expect.any(Date) });
    expect(email.enqueueMessage).toHaveBeenCalledWith(
      'm1', 'acme',
      { from: { name: 'Acme', address: 'no-reply@saas.test' }, to: ['a@acme.test'], subject: 'Hi', html: '<p>secret html</p>', text: 'secret text' },
      false,
      expect.stringMatching(/^m1:retry:/), // a new BullMQ job id: the failed job may still exist under the old one
    );
    await expect(service.retry('acme', 'm1')).rejects.toBeInstanceOf(ConflictException);
    expect(email.enqueueMessage).toHaveBeenCalledTimes(1);
  });

  it('retry keeps the reply-to of the original message', async () => {
    const { service, email } = setup([row({ replyTo: 'budi@acme.test' })]);
    await service.retry('acme', 'm1');
    expect((email.enqueueMessage.mock.calls[0] as any[])[2]).toMatchObject({ replyTo: 'budi@acme.test' });
  });

  it('retry refuses a redacted message with "ask the user to request a new link"', async () => {
    const { service, email } = setup([row({ redacted: true })]);
    await expect(service.retry('acme', 'm1')).rejects.toThrow(/ask the user to request a new link/i);
    expect(email.enqueueMessage).not.toHaveBeenCalled();
  });

  it('retry refuses a SENT message', async () => {
    const { service } = setup([row({ status: 'SENT' })]);
    await expect(service.retry('acme', 'm1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('platform calls (no tenant) read the public schema', async () => {
    const { service, prisma, email } = setup([], [row({ id: 'p1', tenantSlug: 'acme' })]);

    expect((await service.list(null, { page: 1, limit: 20 })).data.map((r: Row) => r.id)).toEqual(['p1']);
    await service.retry(null, 'p1');

    expect(prisma.getTenantClient).not.toHaveBeenCalled();
    expect(email.enqueueMessage).toHaveBeenCalledWith('p1', null, expect.anything(), false, expect.any(String));
  });

  describe('a workspace log also lists the platform emails sent to it', () => {
    const at = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 28, hh, mm));
    const own = () => [row({ id: 'm1', createdAt: at(10) }), row({ id: 'm3', createdAt: at(12), status: 'SENT' })];
    const platform = () => [
      row({ id: 'p1', tenantSlug: 'acme', templateKey: 'core.billing-invoice-issued', createdAt: at(11), status: 'SENT' }),
      row({ id: 'p2', tenantSlug: 'globex', templateKey: 'core.billing-invoice-issued', createdAt: at(11, 30), status: 'SENT' }),
      // Sent to the platform's sales inbox: never shown to a workspace
      row({ id: 'p3', tenantSlug: 'acme', templateKey: 'core.contact-sales', createdAt: at(11, 45), status: 'SENT' }),
    ];
    const ids = (page: { data: Row[] }) => page.data.map((r) => r.id);

    it('newest first, each row marked with where it came from', async () => {
      const { service } = setup(own(), platform());

      const page = await service.list('acme', { page: 1, limit: 20 });

      expect(ids(page)).toEqual(['m3', 'p1', 'm1']);
      expect(page.data.map((r: Row) => r.origin)).toEqual(['tenant', 'platform', 'tenant']);
      expect(page.meta).toEqual({ total: 3, page: 1, limit: 20, totalPages: 1 });
      expect(page.data[1]).not.toHaveProperty('html');
    });

    it('pages across both sources', async () => {
      const tenantRows = [1, 3, 5].map((h) => row({ id: `t${h}`, createdAt: at(h) }));
      const publicRows = [2, 4, 6].map((h) => row({ id: `p${h}`, tenantSlug: 'acme', templateKey: 'core.billing-paused', createdAt: at(h) }));
      const { service } = setup(tenantRows, publicRows);

      const second = await service.list('acme', { page: 2, limit: 2 });
      const pastTheEnd = await service.list('acme', { page: 4, limit: 2 });

      expect(ids(second)).toEqual(['p4', 't3']);
      expect(second.meta).toEqual({ total: 6, page: 2, limit: 2, totalPages: 3 });
      expect(pastTheEnd.data).toEqual([]);
      expect(pastTheEnd.meta).toMatchObject({ total: 6, totalPages: 3 });
    });

    it('origin filter', async () => {
      const { service } = setup(own(), platform());
      expect(ids(await service.list('acme', { origin: 'platform', page: 1, limit: 20 }))).toEqual(['p1']);
      expect(ids(await service.list('acme', { origin: 'tenant', page: 1, limit: 20 }))).toEqual(['m3', 'm1']);
    });

    it('status and template filters apply to both sources', async () => {
      const { service } = setup(own(), platform());
      expect(ids(await service.list('acme', { status: 'SENT', page: 1, limit: 20 }))).toEqual(['m3', 'p1']);
      expect(ids(await service.list('acme', { template: 'core.billing-invoice-issued', page: 1, limit: 20 }))).toEqual(['p1']);
    });

    it('filtering by an internal template shows no platform rows', async () => {
      const { service } = setup(own(), platform());
      const page = await service.list('acme', { template: 'core.contact-sales', page: 1, limit: 20 });
      expect(page.data).toEqual([]);
      expect(page.meta.total).toBe(0);
    });

    it('a workspace can open a platform email sent to it, not one for another workspace or an internal one', async () => {
      const { service } = setup(own(), platform());
      await expect(service.get('acme', 'p1')).resolves.toMatchObject({ id: 'p1', origin: 'platform', html: '<p>secret html</p>' });
      await expect(service.get('acme', 'm1')).resolves.toMatchObject({ origin: 'tenant' });
      await expect(service.get('acme', 'p2')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.get('acme', 'p3')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retry refuses a platform email in a workspace log', async () => {
      const { service, publicMessages, email } = setup(own(), [row({ id: 'p1', tenantSlug: 'acme', templateKey: 'core.billing-paused' })]);

      await expect(service.retry('acme', 'p1')).rejects.toBeInstanceOf(ForbiddenException);

      expect(publicMessages.updateMany).not.toHaveBeenCalled();
      expect(email.enqueueMessage).not.toHaveBeenCalled();
    });

    it('every page matches a naive merge of both sources, for many interleavings', async () => {
      let seed = 7;
      const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
      for (let round = 0; round < 20; round++) {
        const tenantRows = Array.from({ length: Math.floor(random() * 9) }, (_, i) => row({ id: `t${i}`, createdAt: new Date(Date.UTC(2026, 9, 28) + Math.floor(random() * 1e6) * 1000) }));
        const publicRows = Array.from({ length: Math.floor(random() * 6) }, (_, i) =>
          row({ id: `p${i}`, tenantSlug: 'acme', templateKey: 'core.billing-paused', createdAt: new Date(Date.UTC(2026, 9, 28) + Math.floor(random() * 1e6) * 1000) }));
        const expected = [...tenantRows, ...publicRows].sort((a, b) => b.createdAt - a.createdAt).map((r) => r.id);
        for (const limit of [1, 2, 3, 5]) {
          const { service } = setup(tenantRows, publicRows);
          for (let page = 1; page <= Math.ceil(expected.length / limit) + 1; page++) {
            const result = await service.list('acme', { page, limit });
            expect(ids(result)).toEqual(expected.slice((page - 1) * limit, page * limit));
            expect(result.meta.total).toBe(expected.length);
          }
        }
      }
    });

    it('a deep page reads only the rows around it, not the whole log', async () => {
      const tenantRows = Array.from({ length: 50 }, (_, i) => row({ id: `t${i}`, createdAt: new Date(Date.UTC(2026, 9, 1) + i * 60_000) }));
      const publicRows = [row({ id: 'p0', tenantSlug: 'acme', templateKey: 'core.billing-paused', createdAt: new Date(Date.UTC(2026, 9, 1) + 25 * 60_000 + 1) })];
      const { service, tenantMessages, publicMessages } = setup(tenantRows, publicRows);

      const last = await service.list('acme', { page: 26, limit: 2 });
      const pastTheEnd = await service.list('acme', { page: 1000, limit: 2 });

      expect(ids(last)).toEqual(['t0']);
      expect(pastTheEnd.data).toEqual([]);
      const reads = [...tenantMessages.findMany.mock.calls, ...publicMessages.findMany.mock.calls].map(([args]: any[]) => args.take);
      expect(Math.max(...reads)).toBeLessThanOrEqual(2 + publicRows.length); // limit + the workspace's platform rows
    });

    it("a workspace that reuses a deleted workspace's slug doesn't see that workspace's platform emails", async () => {
      // p1 (11:00) was sent to the old acme; this acme was created at 11:10
      const { service } = setup(own(), [...platform(), row({ id: 'p4', tenantSlug: 'acme', templateKey: 'core.tenant-welcome', createdAt: at(11, 20) })], { tenantCreatedAt: at(11, 10) });

      expect(ids(await service.list('acme', { page: 1, limit: 20 }))).toEqual(['m3', 'p4', 'm1']);
      await expect(service.get('acme', 'p1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.get('acme', 'p4')).resolves.toMatchObject({ origin: 'platform' });
    });

    it('the platform log filters by workspace and marks every row as platform', async () => {
      const { service } = setup([], platform());
      const page = await service.list(null, { tenant: 'globex', page: 1, limit: 20 });
      expect(ids(page)).toEqual(['p2']);
      expect(page.data[0].origin).toBe('platform');
    });
  });
});
