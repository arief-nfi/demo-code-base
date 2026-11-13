import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmailTemplatesController } from './email-templates.controller';
import { draftEmailTemplateSchema } from './dto/save-email-template.dto';

const RESET = {
  key: 'core.password-reset', scope: 'tenant', source: 'core', name: 'Password reset', description: 'd',
  variables: [{ name: 'resetUrl' }], required: ['resetUrl'], sensitive: ['resetUrl'], sample: {},
  defaults: { en: { subject: 'Reset', html: '' }, id: { subject: 'Atur', html: '' } },
};
const ARTICLE = { ...RESET, key: 'sample-plugin.article-published', source: 'sample-plugin', name: 'Article published', sensitive: [], required: [] };

function setup(edits: Array<Record<string, any>> = []) {
  const templates = {
    listEdits: jest.fn(async () => edits),
    save: jest.fn(async () => ({ version: 1 })),
    reset: jest.fn(async () => ({ count: 1 })),
  };
  const email = {
    listTenantDefinitions: jest.fn(async () => [RESET, ARTICLE]),
    // An edit whose html contains "BROKEN" fails the current definition's checks
    checkEdit: jest.fn((_key: string, content: { html: string }) => (content.html.includes('BROKEN') ? ['"resetUrl" must stay in the email'] : [])),
    preview: jest.fn(async () => ({ subject: 'S', html: '<p>h</p>', text: 't' })),
    sendTest: jest.fn(async () => ({ messageId: 'm1', status: 'QUEUED' })),
  };
  const tenantClient = { user: { findUnique: jest.fn(async () => ({ email: 'me@acme.test' })) } };
  const prisma = { getTenantClient: jest.fn(() => tenantClient) };
  const controller = new EmailTemplatesController(templates as any, email as any, prisma as any);
  const req = { tenant: { slug: 'acme' }, user: { userId: 'u1' } } as any;
  return { controller, templates, email, tenantClient, req };
}

describe('EmailTemplatesController', () => {
  it('list marks default, customized and needs_attention per locale', async () => {
    const updatedAt = new Date('2026-10-21T10:00:00Z');
    const { controller, req } = setup([
      { key: 'core.password-reset', locale: 'en', subject: 'S', html: '{{button resetUrl "x"}}', updatedAt },
      { key: 'core.password-reset', locale: 'id', subject: 'S', html: 'BROKEN', updatedAt },
    ]);

    const list = await controller.list(req);

    expect(list.map((e) => e.key)).toEqual(['core.password-reset', 'sample-plugin.article-published']);
    expect(list[0].locales).toEqual({
      en: { state: 'customized', problems: [], updatedAt: '2026-10-21T10:00:00.000Z' },
      id: { state: 'needs_attention', problems: ['"resetUrl" must stay in the email'], updatedAt: '2026-10-21T10:00:00.000Z' },
    });
    expect(list[1].locales.en).toEqual({ state: 'default', problems: [] });
  });

  it('get returns the definition with the edits per language', async () => {
    const { controller, req } = setup([{ key: 'core.password-reset', locale: 'en', subject: 'S', html: 'BROKEN', version: 3, updatedAt: new Date(), updatedBy: 'u1' }]);

    const detail = await controller.get(req, 'core.password-reset');

    expect(detail.key).toBe('core.password-reset');
    expect(detail.edits.en).toMatchObject({ subject: 'S', version: 3, problems: ['"resetUrl" must stay in the email'] });
    expect(detail.edits.id).toBeNull();
  });

  it('unknown key is 404 (including emails of plugins the tenant has not enabled)', async () => {
    const { controller, req } = setup();
    await expect(controller.get(req, 'other-plugin.x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.save(req, 'core.nope', 'en', { subject: 'S', html: '' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bad locale is 400', async () => {
    const { controller, req, templates } = setup();
    await expect(controller.save(req, 'core.password-reset', 'fr', { subject: 'S', html: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(templates.save).not.toHaveBeenCalled();
  });

  it('save stores the edit as the signed-in user', async () => {
    const { controller, req, templates } = setup();
    await controller.save(req, 'core.password-reset', 'id', { subject: 'S', html: '<p>x</p>' });
    expect(templates.save).toHaveBeenCalledWith('acme', 'core.password-reset', 'id', { subject: 'S', html: '<p>x</p>' }, 'u1');
  });

  it('preview sanitizes the draft before rendering it', async () => {
    const { controller, req, email } = setup();

    await controller.preview(req, 'core.password-reset', 'en', { subject: 'S', html: '<p onclick="x()">Hi</p>' });

    expect(email.preview).toHaveBeenCalledWith('acme', 'core.password-reset', 'en', { subject: 'S', html: '<p>Hi</p>' });
  });

  it('an empty body means "no draft" for preview and test send', async () => {
    const { controller, req, email } = setup();
    const body = draftEmailTemplateSchema.parse({});

    await controller.sendTest(req, 'core.password-reset', 'en', body);
    await controller.preview(req, 'core.password-reset', 'en', body);

    expect(email.sendTest).toHaveBeenCalledWith('acme', 'core.password-reset', 'en', 'me@acme.test', undefined);
    expect(email.preview).toHaveBeenCalledWith('acme', 'core.password-reset', 'en', undefined);
  });

  it("test send goes to the signed-in user's email", async () => {
    const { controller, req, email, tenantClient } = setup();

    await controller.sendTest(req, 'core.password-reset', 'en', undefined);

    expect(tenantClient.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { email: true } });
    expect(email.sendTest).toHaveBeenCalledWith('acme', 'core.password-reset', 'en', 'me@acme.test', undefined);
  });
});
