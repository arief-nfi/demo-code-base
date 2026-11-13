import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS_KEY, ROLES_KEY } from '@saas/backend';
import { PlatformEmailTemplatesController } from './platform-email-templates.controller';

const PAUSED = {
  key: 'core.billing-paused', scope: 'platform', source: 'core', name: 'Plugin or app paused', description: 'd',
  variables: [{ name: 'billingUrl' }], required: ['billingUrl'], sensitive: [], sample: {},
  defaults: { en: { subject: 'Paused', html: '' }, id: { subject: 'Dijeda', html: '' } },
};

function setup(edits: Array<Record<string, any>> = [], tenantSlug = 'system') {
  const templates = {
    listEdits: jest.fn(async () => edits),
    save: jest.fn(async () => ({ version: 1 })),
    reset: jest.fn(async () => ({ count: 1 })),
  };
  const email = {
    // Only platform definitions: a tenant email key is unknown here
    listPlatformDefinitions: jest.fn(() => [PAUSED]),
    // An edit whose html contains "BROKEN" fails the current definition's checks
    checkEdit: jest.fn((_key: string, content: { html: string }) => (content.html.includes('BROKEN') ? ['"billingUrl" must stay in the email'] : [])),
    preview: jest.fn(async () => ({ subject: 'S', html: '<p>h</p>', text: 't' })),
    sendTest: jest.fn(async () => ({ messageId: 'm1', status: 'QUEUED' })),
  };
  const systemClient = { user: { findUnique: jest.fn(async () => ({ email: 'admin@system.test' })) } };
  const prisma = { getTenantClient: jest.fn(() => systemClient) };
  const controller = new PlatformEmailTemplatesController(templates as any, email as any, prisma as any);
  const req = { tenant: { slug: tenantSlug }, user: { userId: 'u1' } } as any;
  return { controller, templates, email, prisma, systemClient, req };
}

describe('PlatformEmailTemplatesController', () => {
  it('only SYSADMIN, and no permission that would let tenant admins in', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PlatformEmailTemplatesController)).toEqual(['SYSADMIN']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PlatformEmailTemplatesController)).toBeUndefined();
    for (const name of ['list', 'get', 'save', 'reset', 'preview', 'sendTest']) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, (PlatformEmailTemplatesController.prototype as any)[name])).toBeUndefined();
    }
  });

  it('list reads the public-schema edits and marks states per language', async () => {
    const updatedAt = new Date('2026-10-28T10:00:00Z');
    const { controller, req, templates } = setup([
      { key: 'core.billing-paused', locale: 'en', subject: 'S', html: '<p>ok</p>', updatedAt },
      { key: 'core.billing-paused', locale: 'id', subject: 'S', html: 'BROKEN', updatedAt },
    ]);

    const list = await controller.list(req);

    expect(templates.listEdits).toHaveBeenCalledWith(null);
    expect(list).toEqual([{
      key: 'core.billing-paused',
      name: 'Plugin or app paused',
      description: 'd',
      locales: {
        en: { state: 'customized', problems: [], updatedAt: '2026-10-28T10:00:00.000Z' },
        id: { state: 'needs_attention', problems: ['"billingUrl" must stay in the email'], updatedAt: '2026-10-28T10:00:00.000Z' },
      },
    }]);
  });

  it('get returns the definition with the edits per language', async () => {
    const { controller, req } = setup([{ key: 'core.billing-paused', locale: 'en', subject: 'S', html: 'BROKEN', version: 2, updatedAt: new Date(), updatedBy: 'u1' }]);

    const detail = await controller.get(req, 'core.billing-paused');

    expect(detail.key).toBe('core.billing-paused');
    expect(detail.edits.en).toMatchObject({ subject: 'S', version: 2, problems: ['"billingUrl" must stay in the email'] });
    expect(detail.edits.id).toBeNull();
  });

  it('a tenant email key is 404 on the platform endpoints', async () => {
    const { controller, req, templates } = setup();
    await expect(controller.get(req, 'core.password-reset')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.save(req, 'core.password-reset', 'en', { subject: 'S', html: '' })).rejects.toBeInstanceOf(NotFoundException);
    expect(templates.save).not.toHaveBeenCalled();
  });

  it('refuses a request outside the System workspace', async () => {
    const { controller, req, templates } = setup([], 'acme');
    await expect(controller.list(req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.save(req, 'core.billing-paused', 'en', { subject: 'S', html: '' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(templates.save).not.toHaveBeenCalled();
  });

  it('save stores the edit in the public schema as the signed-in sysadmin', async () => {
    const { controller, req, templates } = setup();
    await controller.save(req, 'core.billing-paused', 'en', { subject: 'S', html: '<p>x</p>' });
    expect(templates.save).toHaveBeenCalledWith(null, 'core.billing-paused', 'en', { subject: 'S', html: '<p>x</p>' }, 'u1');
  });

  it('reset deletes the public-schema edit for that language', async () => {
    const { controller, req, templates } = setup();
    await controller.reset(req, 'core.billing-paused', 'id');
    expect(templates.reset).toHaveBeenCalledWith(null, 'core.billing-paused', 'id');
  });

  it('preview and test send use the platform scope', async () => {
    const { controller, req, email, systemClient } = setup();

    await controller.preview(req, 'core.billing-paused', 'en', { subject: 'S', html: '<p onclick="x()">Hi</p>' });
    await controller.sendTest(req, 'core.billing-paused', 'en', undefined);

    expect(email.preview).toHaveBeenCalledWith(null, 'core.billing-paused', 'en', { subject: 'S', html: '<p>Hi</p>' });
    expect(systemClient.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { email: true } });
    expect(email.sendTest).toHaveBeenCalledWith(null, 'core.billing-paused', 'en', 'admin@system.test', undefined);
  });
});
