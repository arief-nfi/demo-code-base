import { createEmailRenderer, type EmailDefinition } from '@saas/backend';
import { BillingEmails } from './billing.emails';

const layout = { brandName: 'SaaS', footerText: 'x' };
const invoice = { number: 'INV-2026-0042', amount: 'Rp 80.000', billingUrl: 'https://app.test/billing' };
const def = (key: string) => BillingEmails.find((e) => e.key === key) as EmailDefinition;
const render = (key: string, locale: 'en' | 'id', data: Record<string, unknown>) =>
  createEmailRenderer().render(def(key).defaults[locale], data, layout);

describe('billing emails for an app', () => {
  const app = { ...invoice, pluginName: 'Warehouse', isApp: true };
  const plugin = { ...invoice, pluginName: 'Document Templates', isApp: false };

  it('paused: says app and names the plugins that were switched off', () => {
    const en = render('core.billing-paused', 'en', { ...app, switchedOff: 'Inventory, Procurement' });
    expect(en.subject).toBe('App paused — Warehouse');
    expect(en.html).toContain('Pay the invoice to switch Inventory, Procurement back on.');

    const id = render('core.billing-paused', 'id', { ...app, switchedOff: 'Inventory, Procurement' });
    expect(id.subject).toBe('Aplikasi dijeda — Warehouse');
    expect(id.html).toContain('Bayar tagihan untuk mengaktifkan kembali Inventory, Procurement.');
  });

  it('paused with no plugin list: the app comes back on', () => {
    expect(render('core.billing-paused', 'en', { ...app, switchedOff: '' }).html).toContain('Pay the invoice to switch the app back on.');
    expect(render('core.billing-paused', 'id', { ...app, switchedOff: '' }).html).toContain('Bayar tagihan untuk mengaktifkan kembali aplikasi.');
  });

  it('paused: a plugin keeps the plugin wording', () => {
    const en = render('core.billing-paused', 'en', { ...plugin, switchedOff: '' });
    expect(en.subject).toBe('Plugin paused — Document Templates');
    expect(en.html).toContain('Pay the invoice to switch the plugin back on.');
    expect(render('core.billing-paused', 'id', { ...plugin, switchedOff: '' }).subject).toBe('Plugin dijeda — Document Templates');
  });

  it('past due: the app will be paused, or the plugin', () => {
    expect(render('core.billing-past-due', 'en', { ...app, graceDays: 7 }).html).toContain('Pay within 7 days, or the app will be paused.');
    expect(render('core.billing-past-due', 'id', { ...app, graceDays: 7 }).html).toContain('Bayar dalam 7 hari, atau aplikasi akan dijeda.');
    expect(render('core.billing-past-due', 'en', { ...plugin, graceDays: 7 }).html).toContain('Pay within 7 days, or the plugin will be paused.');
    expect(render('core.billing-past-due', 'id', { ...plugin, graceDays: 7 }).html).toContain('Bayar dalam 7 hari, atau plugin akan dijeda.');
  });

  it('plugin names in the list are escaped', () => {
    const en = render('core.billing-paused', 'en', { ...app, switchedOff: '<b>x</b>' });
    expect(en.html).not.toContain('<b>x</b>');
    expect(en.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
