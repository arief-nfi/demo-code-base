import { BadRequestException } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';

function fakeTenantDb() {
  const rows: Array<Record<string, any>> = [];
  const match = (row: Record<string, any>, where: Record<string, any>) =>
    where.key_locale ? row.key === where.key_locale.key && row.locale === where.key_locale.locale : Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    emailTemplate: {
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
      findMany: jest.fn(async () => rows),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const row = rows.find((r) => match(r, where));
        if (!row) {
          const created = { id: `e${rows.length + 1}`, version: 1, updatedAt: new Date(), ...create };
          rows.push(created);
          return { ...created };
        }
        Object.assign(row, { ...update, version: row.version + (update.version?.increment ?? 0), updatedAt: new Date() });
        return { ...row }; // Prisma returns a fresh object, not the stored row
      }),
      create: jest.fn(async ({ data }: any) => {
        if (rows.some((r) => r.key === data.key && r.locale === data.locale)) {
          throw Object.assign(new Error('Unique constraint failed on the fields: (`key`,`locale`)'), { code: 'P2002' });
        }
        const created = { id: `e${rows.length + 1}`, version: 1, updatedAt: new Date(), ...data };
        rows.push(created);
        return { ...created };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => match(r, where));
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        Object.assign(row, { ...data, version: row.version + (data.version?.increment ?? 0), updatedAt: new Date() });
        return { ...row };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
        return { count: before - rows.length };
      }),
    },
  };
}

function setup(problems: string[] = []) {
  const db = fakeTenantDb();
  // Platform edits live in the public schema: the main client's emailTemplate
  const publicDb = fakeTenantDb();
  const prisma = { getTenantClient: jest.fn(() => db), emailTemplate: publicDb.emailTemplate };
  const email = { checkEdit: jest.fn(() => problems) };
  return { service: new EmailTemplatesService(prisma as any, email as any), db, publicDb, email, prisma };
}

const content = { subject: 'Reset', html: '<p>Hi</p>{{button resetUrl "Go"}}' };

describe('EmailTemplatesService', () => {
  it('declares document-templates as the plugin that gates the edits', () => {
    expect(setup().service.pluginKey).toBe('document-templates');
  });

  it('find returns the stored edit for key+locale, else null', async () => {
    const { service, db, prisma } = setup();
    db.rows.push({ key: 'core.password-reset', locale: 'id', subject: 'S', html: '<p>x</p>', version: 1 });

    await expect(service.find('acme', 'core.password-reset', 'id')).resolves.toEqual({ subject: 'S', html: '<p>x</p>' });
    await expect(service.find('acme', 'core.password-reset', 'en')).resolves.toBeNull();
    expect(prisma.getTenantClient).toHaveBeenCalledWith('acme');
  });

  it('save sanitizes before checking and storing', async () => {
    const { service, db, email } = setup();

    await service.save('acme', 'core.password-reset', 'en', { subject: 'Reset', html: '<p onclick="steal()">Hi</p><script>x()</script>{{button resetUrl "Go"}}' }, 'u1');

    const cleaned = '<p>Hi</p>{{button resetUrl "Go"}}';
    expect(email.checkEdit).toHaveBeenCalledWith('core.password-reset', { subject: 'Reset', html: cleaned });
    expect(db.rows[0]).toMatchObject({ key: 'core.password-reset', locale: 'en', html: cleaned });
  });

  it('save rejects with the problems from checkEdit and stores nothing', async () => {
    const { service, db } = setup(['"resetUrl" must stay in the email']);

    const error = await service.save('acme', 'core.password-reset', 'en', content, 'u1').catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    // `errors` is the shape GlobalExceptionFilter passes through to the client
    expect(error.getResponse()).toMatchObject({ errors: { template: ['"resetUrl" must stay in the email'] } });
    expect(db.rows).toHaveLength(0);
  });

  it('save increments version and records updatedBy', async () => {
    const { service } = setup();

    const first = await service.save('acme', 'core.password-reset', 'en', content, 'u1');
    const second = await service.save('acme', 'core.password-reset', 'en', { ...content, subject: 'Reset 2' }, 'u2');

    expect(first).toMatchObject({ version: 1, createdBy: 'u1', updatedBy: 'u1' });
    expect(second).toMatchObject({ version: 2, createdBy: 'u1', updatedBy: 'u2', subject: 'Reset 2' });
  });

  it('save writes with create and update, which the audit log records (it ignores upsert)', async () => {
    const { service, db } = setup();

    await service.save('acme', 'core.password-reset', 'en', content, 'u1');
    await service.save('acme', 'core.password-reset', 'en', { ...content, subject: 'Reset 2' }, 'u2');

    expect(db.emailTemplate.create).toHaveBeenCalledTimes(1);
    expect(db.emailTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { key_locale: { key: 'core.password-reset', locale: 'en' } },
      data: expect.objectContaining({ subject: 'Reset 2', version: { increment: 1 }, updatedBy: 'u2' }),
    }));
    expect(db.emailTemplate.upsert).not.toHaveBeenCalled();
  });

  it('a first save that loses the race to another first save becomes an update', async () => {
    const { service, db } = setup();
    // Another save creates the row between this save's lookup and its create
    db.emailTemplate.findUnique.mockImplementationOnce(async () => {
      db.rows.push({ id: 'e1', key: 'core.password-reset', locale: 'en', subject: 'Other', html: '', version: 1, createdBy: 'u9', updatedAt: new Date() });
      return null;
    });

    const saved = await service.save('acme', 'core.password-reset', 'en', content, 'u1');

    expect(saved).toMatchObject({ version: 2, createdBy: 'u9', updatedBy: 'u1', subject: 'Reset' });
    expect(db.rows).toHaveLength(1);
  });

  it('save rejects a subject with a newline', async () => {
    const { service, db } = setup();

    await expect(service.save('acme', 'core.password-reset', 'en', { ...content, subject: 'Hi\r\nBcc: x@y.z' }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.rows).toHaveLength(0);
  });

  it('reset deletes only that locale', async () => {
    const { service, db } = setup();
    await service.save('acme', 'core.password-reset', 'en', content, 'u1');
    await service.save('acme', 'core.password-reset', 'id', content, 'u1');

    await service.reset('acme', 'core.password-reset', 'en');

    expect(db.rows.map((r) => r.locale)).toEqual(['id']);
  });

  describe('platform edits (tenantSlug null) live in the public schema', () => {
    it('find(null, ...) reads the public schema', async () => {
      const { service, db, publicDb, prisma } = setup();
      publicDb.rows.push({ key: 'core.billing-paused', locale: 'en', subject: 'Paused', html: '<p>p</p>', version: 1 });
      db.rows.push({ key: 'core.billing-paused', locale: 'en', subject: 'Tenant copy', html: '<p>t</p>', version: 1 });

      await expect(service.find(null, 'core.billing-paused', 'en')).resolves.toEqual({ subject: 'Paused', html: '<p>p</p>' });
      expect(prisma.getTenantClient).not.toHaveBeenCalled();
    });

    it('save(null, ...) writes to the public schema', async () => {
      const { service, db, publicDb } = setup();

      await service.save(null, 'core.billing-paused', 'en', { subject: 'Paused', html: '<p>p</p>' }, 'u1');

      expect(publicDb.rows).toEqual([expect.objectContaining({ key: 'core.billing-paused', locale: 'en', createdBy: 'u1' })]);
      expect(db.rows).toHaveLength(0);
    });

    it('reset(null, ...) deletes from the public schema', async () => {
      const { service, db, publicDb } = setup();
      publicDb.rows.push({ key: 'core.billing-paused', locale: 'en', subject: 'S', html: '', version: 1 });
      db.rows.push({ key: 'core.billing-paused', locale: 'en', subject: 'S', html: '', version: 1 });

      await service.reset(null, 'core.billing-paused', 'en');

      expect(publicDb.rows).toHaveLength(0);
      expect(db.rows).toHaveLength(1);
    });
  });
});
