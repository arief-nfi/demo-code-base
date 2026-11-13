import { z } from 'zod';
import { defineEmail, type EmailDefinition } from '@saas/backend';

// Billing notices are the platform billing the tenant, so they are platform emails.
const H2 = 'style="margin:0 0 16px 0;font-size:20px;color:#111827;"';
const invoice = { pluginName: z.string(), number: z.string(), amount: z.string().describe('Formatted total, e.g. Rp 166.500'), billingUrl: z.string() };
const sample = { pluginName: 'Document Templates', number: 'INV-2026-0042', amount: 'Rp 166.500', billingUrl: 'https://app.example.com/billing' };
const isApp = z.boolean().describe('The invoice is for an app (a bundle of plugins); pluginName is then the app name');

const invoiceIssued = defineEmail({
  key: 'core.billing-invoice-issued',
  scope: 'platform',
  showInTenantLog: true,
  name: 'New invoice',
  description: 'Sent to the billing contact when an invoice is issued',
  variables: z.object({ ...invoice, due: z.string().describe('Formatted due date') }),
  sample: { ...sample, due: '21 Oct 2026' },
  required: ['billingUrl'],
  defaults: {
    en: {
      subject: 'Invoice {{number}} — {{pluginName}}',
      html: `<h2 ${H2}>New invoice for {{pluginName}}</h2>
<p>Invoice {{number}}: {{amount}}</p>
<p>Due {{due}}</p>
{{button billingUrl "View and pay"}}`,
    },
    id: {
      subject: 'Tagihan {{number}} — {{pluginName}}',
      html: `<h2 ${H2}>Tagihan baru untuk {{pluginName}}</h2>
<p>Tagihan {{number}}: {{amount}}</p>
<p>Jatuh tempo {{due}}</p>
{{button billingUrl "Lihat dan bayar"}}`,
    },
  },
});

const invoicePaid = defineEmail({
  key: 'core.billing-invoice-paid',
  scope: 'platform',
  showInTenantLog: true,
  name: 'Payment received',
  description: 'Sent to the billing contact when an invoice is paid',
  variables: z.object(invoice),
  sample,
  required: ['billingUrl'],
  defaults: {
    en: {
      subject: 'Payment received — {{number}}',
      html: `<h2 ${H2}>Payment received</h2>
<p>Invoice {{number}} for {{pluginName}}: {{amount}} — paid.</p>
{{button billingUrl "View invoice"}}`,
    },
    id: {
      subject: 'Pembayaran diterima — {{number}}',
      html: `<h2 ${H2}>Pembayaran diterima</h2>
<p>Tagihan {{number}} untuk {{pluginName}}: {{amount}} — lunas.</p>
{{button billingUrl "Lihat tagihan"}}`,
    },
  },
});

const paidWithCredit = defineEmail({
  key: 'core.billing-paid-with-credit',
  scope: 'platform',
  showInTenantLog: true,
  name: 'Paid from credit',
  description: "Sent when the tenant's credit covers a whole invoice (nothing to pay)",
  variables: z.object({ pluginName: z.string(), number: z.string(), credit: z.string().describe('Formatted credit used, e.g. Rp 150.000'), billingUrl: z.string() }),
  sample: { pluginName: sample.pluginName, number: sample.number, credit: 'Rp 150.000', billingUrl: sample.billingUrl },
  required: ['billingUrl'],
  defaults: {
    en: {
      subject: 'Paid from your credit — {{number}}',
      html: `<h2 ${H2}>Paid from your credit</h2>
<p>Invoice {{number}} for {{pluginName}} was paid from your credit ({{credit}}). There is nothing to pay.</p>
{{button billingUrl "View invoice"}}`,
    },
    id: {
      subject: 'Dibayar dari kredit Anda — {{number}}',
      html: `<h2 ${H2}>Dibayar dari kredit Anda</h2>
<p>Tagihan {{number}} untuk {{pluginName}} dibayar dari kredit Anda ({{credit}}). Tidak ada yang perlu dibayar.</p>
{{button billingUrl "Lihat tagihan"}}`,
    },
  },
});

const complimentary = defineEmail({
  key: 'core.billing-complimentary',
  scope: 'platform',
  showInTenantLog: true,
  name: 'Plugin or app activated at no charge',
  description: 'Sent when a sysadmin marks an invoice as complimentary (nothing was paid)',
  variables: z.object({ pluginName: z.string(), number: z.string(), billingUrl: z.string() }),
  sample: { pluginName: sample.pluginName, number: sample.number, billingUrl: sample.billingUrl },
  required: ['billingUrl'],
  defaults: {
    en: {
      subject: '{{pluginName}} activated — complimentary',
      html: `<h2 ${H2}>{{pluginName}} is active</h2>
<p>{{pluginName}} has been activated at no charge (invoice {{number}}, complimentary).</p>
{{button billingUrl "View billing"}}`,
    },
    id: {
      subject: '{{pluginName}} diaktifkan — gratis',
      html: `<h2 ${H2}>{{pluginName}} sudah aktif</h2>
<p>{{pluginName}} telah diaktifkan tanpa biaya (tagihan {{number}}, gratis).</p>
{{button billingUrl "Lihat tagihan"}}`,
    },
  },
});

const pastDue = defineEmail({
  key: 'core.billing-past-due',
  scope: 'platform',
  showInTenantLog: true,
  name: 'Payment overdue',
  description: 'Sent when a renewal invoice is unpaid after its due date',
  variables: z.object({ ...invoice, isApp, graceDays: z.number().describe('Days left before the plugin or app is paused') }),
  sample: { ...sample, isApp: false, graceDays: 7 },
  required: ['billingUrl'],
  defaults: {
    en: {
      subject: 'Payment overdue — {{pluginName}}',
      html: `<h2 ${H2}>Your {{pluginName}} subscription is overdue</h2>
<p>Invoice {{number}}: {{amount}}</p>
<p>Pay within {{graceDays}} days, or the {{#if isApp}}app{{else}}plugin{{/if}} will be paused.</p>
{{button billingUrl "Pay now"}}`,
    },
    id: {
      subject: 'Pembayaran terlambat — {{pluginName}}',
      html: `<h2 ${H2}>Langganan {{pluginName}} Anda terlambat dibayar</h2>
<p>Tagihan {{number}}: {{amount}}</p>
<p>Bayar dalam {{graceDays}} hari, atau {{#if isApp}}aplikasi{{else}}plugin{{/if}} akan dijeda.</p>
{{button billingUrl "Bayar sekarang"}}`,
    },
  },
});

const paused = defineEmail({
  key: 'core.billing-paused',
  scope: 'platform',
  showInTenantLog: true,
  name: 'Plugin or app paused',
  description: 'Sent when an unpaid plugin or app is paused',
  variables: z.object({
    ...invoice,
    isApp,
    switchedOff: z.string().describe('Apps: the plugins the pause switched off, e.g. Inventory, Procurement (empty when none or unknown)'),
  }),
  sample: { ...sample, isApp: false, switchedOff: '' },
  required: ['billingUrl'],
  defaults: {
    en: {
      subject: '{{#if isApp}}App{{else}}Plugin{{/if}} paused — {{pluginName}}',
      html: `<h2 ${H2}>{{pluginName}} is paused</h2>
<p>Invoice {{number}} ({{amount}}) is unpaid.</p>
<p>Your data is kept. Pay the invoice to switch {{#if isApp}}{{#if switchedOff}}{{switchedOff}}{{else}}the app{{/if}}{{else}}the plugin{{/if}} back on.</p>
{{button billingUrl "Pay now"}}`,
    },
    id: {
      subject: '{{#if isApp}}Aplikasi{{else}}Plugin{{/if}} dijeda — {{pluginName}}',
      html: `<h2 ${H2}>{{pluginName}} dijeda</h2>
<p>Tagihan {{number}} ({{amount}}) belum dibayar.</p>
<p>Data Anda tetap tersimpan. Bayar tagihan untuk mengaktifkan kembali {{#if isApp}}{{#if switchedOff}}{{switchedOff}}{{else}}aplikasi{{/if}}{{else}}plugin{{/if}}.</p>
{{button billingUrl "Bayar sekarang"}}`,
    },
  },
});

export const BillingEmails: EmailDefinition[] = [invoiceIssued, invoicePaid, paidWithCredit, complimentary, pastDue, paused];
