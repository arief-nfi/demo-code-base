import { z } from 'zod';
import { createEmailRenderer, defineEmail, type EmailDefinition } from '@saas/backend';
import { EmailDefinitionsRegistry } from './definitions-registry';
import { CoreEmails } from './definitions/core.emails';
import { PluginEmails } from '../plugin-registry';

function email(overrides: Partial<EmailDefinition> = {}): EmailDefinition {
  return defineEmail({
    key: 'core.welcome',
    scope: 'tenant',
    name: 'Welcome',
    description: 'Sent when a user joins',
    variables: z.object({ name: z.string(), url: z.string() }),
    sample: { name: 'Budi', url: 'https://app.test' },
    required: ['url'],
    defaults: {
      en: { subject: 'Welcome {{name}}', html: '<p>Hi {{name}}</p>{{button url "Open"}}' },
      id: { subject: 'Selamat datang {{name}}', html: '<p>Hai {{name}}</p>{{button url "Buka"}}' },
    },
    ...overrides,
  } as EmailDefinition);
}

const build = (core: EmailDefinition[], plugins: Record<string, EmailDefinition[]> = {}) => () => new EmailDefinitionsRegistry(core, plugins);

describe('EmailDefinitionsRegistry', () => {
  it('accepts valid core and plugin definitions', () => {
    const registry = new EmailDefinitionsRegistry([email()], { 'sample-plugin': [email({ key: 'sample-plugin.article-published' })] });

    expect(registry.get('core.welcome')?.source).toBe('core');
    expect(registry.get('sample-plugin.article-published')?.source).toBe('sample-plugin');
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.list().map((e) => e.def.key)).toEqual(['core.welcome', 'sample-plugin.article-published']);
  });

  it("rejects a plugin key outside the plugin's namespace", () => {
    expect(build([], { 'sample-plugin': [email({ key: 'other.x' })] })).toThrow(/other\.x/);
  });

  it('rejects duplicate keys', () => {
    expect(build([email(), email()])).toThrow(/core\.welcome.*more than once/);
  });

  it('rejects scope platform from a plugin', () => {
    expect(build([], { 'sample-plugin': [email({ key: 'sample-plugin.x', scope: 'platform' })] })).toThrow(/platform/);
  });

  it('rejects a core key not starting with core.', () => {
    expect(build([email({ key: 'welcome' })])).toThrow(/welcome/);
  });

  it('rejects a key whose name part is not kebab-case', () => {
    expect(build([email({ key: 'core.Welcome_Mail' })])).toThrow(/core\.Welcome_Mail/);
  });

  it('rejects a definition missing the id default', () => {
    const def = email();
    expect(build([{ ...def, defaults: { en: def.defaults.en } as EmailDefinition['defaults'] }])).toThrow(/"id"/);
  });

  it('rejects a sample that fails its variables schema', () => {
    expect(build([email({ sample: { name: 'Budi' } as never })])).toThrow(/sample/);
  });

  it('rejects required or sensitive names that are not variables', () => {
    expect(build([email({ sensitive: ['token'] })])).toThrow(/token/);
  });

  it('rejects a default that fails the renderer check (e.g. required variable unused)', () => {
    const def = email();
    expect(build([{ ...def, defaults: { ...def.defaults, id: { subject: 'Hai', html: '<p>tanpa tautan</p>' } } }])).toThrow(/"url" must stay/);
  });

  it('lists every problem, not just the first', () => {
    expect(build([email({ key: 'bad' }), email({ key: 'core.x', scope: 'tenant', sample: {} as never })])).toThrow(/bad[\s\S]*core\.x/);
  });

  it('rejects showInTenantLog on a tenant email', () => {
    expect(build([email({ showInTenantLog: true })])).toThrow(/showInTenantLog is only for platform emails/);
  });

  it('the platform emails a workspace sees in its own log', () => {
    const shown = new EmailDefinitionsRegistry(CoreEmails, {}).list().filter((e) => e.def.showInTenantLog).map((e) => e.def.key).sort();

    expect(shown).toEqual([
      'core.billing-complimentary', 'core.billing-invoice-issued', 'core.billing-invoice-paid', 'core.billing-paid-with-credit',
      'core.billing-past-due', 'core.billing-paused',
      'core.tenant-reactivated', 'core.tenant-suspended', 'core.tenant-terminated', 'core.tenant-welcome',
    ]);
    expect(shown).not.toContain('core.contact-sales');
  });

  it('the real registry (CoreEmails + PluginEmails) is valid', () => {
    expect(build(CoreEmails, PluginEmails)).not.toThrow();
  });

  it('core defaults escape tenant and plugin names', () => {
    const def = new EmailDefinitionsRegistry(CoreEmails, {}).get('core.billing-invoice-issued')!.def;
    const layout = { brandName: 'SaaS', footerText: 'x' };
    const data = { pluginName: '<script>alert(1)</script>', number: 'INV-1', amount: 'Rp 1', due: '1 Jan 2027', billingUrl: 'https://app.test/billing' };

    for (const locale of ['en', 'id'] as const) {
      const out = createEmailRenderer().render(def.defaults[locale], data, layout);
      expect(out.html).not.toContain('<script>');
      expect(out.html).toContain('&lt;script&gt;');
    }
  });

  it.each(['core.password-reset', 'core.tenant-welcome'])('%s keeps its link out of the log and out of text (sensitive, required)', (key) => {
    const def = new EmailDefinitionsRegistry(CoreEmails, {}).get(key)!.def;

    expect(def.sensitive).toHaveLength(1);
    expect(def.required).toEqual(def.sensitive);
  });
});
