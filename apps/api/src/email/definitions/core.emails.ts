import { z } from 'zod';
import { defineEmail, type EmailDefinition } from '@saas/backend';
import { BillingEmails } from './billing.emails';

const H2 = 'style="margin:0 0 16px 0;font-size:20px;color:#111827;"';

/** Sent to a tenant user; speaks for the tenant, so tenants can reword it. */
const passwordReset = defineEmail({
  key: 'core.password-reset',
  scope: 'tenant',
  name: 'Password reset',
  description: 'Sent when a user asks to reset their password',
  variables: z.object({
    resetUrl: z.string().describe('Link to choose a new password (hidden in the email log)'),
    expiresInMinutes: z.number().describe('Minutes until the link expires'),
  }),
  sample: { resetUrl: 'https://app.example.com/reset-password?token=sample&tenant=acme', expiresInMinutes: 60 },
  required: ['resetUrl'],
  sensitive: ['resetUrl'],
  defaults: {
    en: {
      subject: 'Reset your password',
      html: `<h2 ${H2}>Reset your password</h2>
<p>We received a request to reset the password for your {{company.name}} account. Click the button below to choose a new password.</p>
{{button resetUrl "Reset password"}}
<p>This link expires in {{expiresInMinutes}} minutes.</p>
<p>If you didn't ask to reset your password, you can ignore this email. Your password won't change.</p>`,
    },
    id: {
      subject: 'Atur ulang kata sandi Anda',
      html: `<h2 ${H2}>Atur ulang kata sandi Anda</h2>
<p>Kami menerima permintaan untuk mengatur ulang kata sandi akun {{company.name}} Anda. Klik tombol di bawah untuk memilih kata sandi baru.</p>
{{button resetUrl "Atur ulang kata sandi"}}
<p>Tautan ini berlaku selama {{expiresInMinutes}} menit.</p>
<p>Jika Anda tidak meminta pengaturan ulang kata sandi, abaikan email ini. Kata sandi Anda tidak akan berubah.</p>`,
    },
  },
});

const tenantWelcome = defineEmail({
  key: 'core.tenant-welcome',
  scope: 'platform',
  showInTenantLog: true,
  name: 'New workspace',
  description: "Sent to a new tenant's admin with a link to set their password",
  variables: z.object({
    tenantName: z.string(),
    username: z.string().describe('The login, e.g. admin@acme'),
    setupUrl: z.string().describe('Link to set the first password (hidden in the email log)'),
  }),
  sample: { tenantName: 'Acme', username: 'admin@acme', setupUrl: 'https://app.example.com/reset-password?token=sample&tenant=acme' },
  required: ['setupUrl'],
  sensitive: ['setupUrl'],
  defaults: {
    en: {
      subject: 'Welcome to {{tenantName}} — set up your account',
      html: `<h2 ${H2}>Welcome to {{tenantName}}!</h2>
<p>Your workspace is ready. To get started, set your password with the button below.</p>
<p><strong>Your username:</strong> {{username}}</p>
{{button setupUrl "Set up your password"}}
<p>This link expires in 24 hours.</p>
<p><strong>Next steps:</strong></p>
<ol><li>Set your password</li><li>Log in with your username</li><li>Configure your workspace settings</li><li>Invite your team</li></ol>
<p>If you have any questions, contact our support team.</p>`,
    },
    id: {
      subject: 'Selamat datang di {{tenantName}} — siapkan akun Anda',
      html: `<h2 ${H2}>Selamat datang di {{tenantName}}!</h2>
<p>Workspace Anda sudah siap. Untuk memulai, atur kata sandi Anda melalui tombol di bawah.</p>
<p><strong>Nama pengguna Anda:</strong> {{username}}</p>
{{button setupUrl "Atur kata sandi"}}
<p>Tautan ini berlaku selama 24 jam.</p>
<p><strong>Langkah berikutnya:</strong></p>
<ol><li>Atur kata sandi Anda</li><li>Masuk dengan nama pengguna Anda</li><li>Atur pengaturan workspace</li><li>Undang tim Anda</li></ol>
<p>Jika ada pertanyaan, hubungi tim dukungan kami.</p>`,
    },
  },
});

const tenantSuspended = defineEmail({
  key: 'core.tenant-suspended',
  scope: 'platform',
  showInTenantLog: true,
  name: 'Workspace suspended',
  description: "Sent to a tenant's admin when the workspace is suspended",
  variables: z.object({ tenantName: z.string(), reason: z.string() }),
  sample: { tenantName: 'Acme', reason: 'Unpaid invoices' },
  defaults: {
    en: {
      subject: 'Account suspended — {{tenantName}}',
      html: `<p>Your account <strong>{{tenantName}}</strong> has been suspended.</p>
<p><strong>Reason:</strong> {{reason}}</p>
<p>Please contact support for assistance.</p>`,
    },
    id: {
      subject: 'Akun ditangguhkan — {{tenantName}}',
      html: `<p>Akun <strong>{{tenantName}}</strong> Anda telah ditangguhkan.</p>
<p><strong>Alasan:</strong> {{reason}}</p>
<p>Silakan hubungi tim dukungan untuk bantuan.</p>`,
    },
  },
});

const tenantReactivated = defineEmail({
  key: 'core.tenant-reactivated',
  scope: 'platform',
  showInTenantLog: true,
  name: 'Workspace reactivated',
  description: "Sent to a tenant's admin when the workspace is active again",
  variables: z.object({ tenantName: z.string(), loginUrl: z.string() }),
  sample: { tenantName: 'Acme', loginUrl: 'https://app.example.com/login' },
  required: ['loginUrl'],
  defaults: {
    en: {
      subject: 'Account reactivated — {{tenantName}}',
      html: `<p>Your account <strong>{{tenantName}}</strong> has been reactivated.</p>
{{button loginUrl "Log in"}}`,
    },
    id: {
      subject: 'Akun diaktifkan kembali — {{tenantName}}',
      html: `<p>Akun <strong>{{tenantName}}</strong> Anda telah diaktifkan kembali.</p>
{{button loginUrl "Masuk"}}`,
    },
  },
});

const tenantTerminated = defineEmail({
  key: 'core.tenant-terminated',
  scope: 'platform',
  showInTenantLog: true,
  name: 'Workspace termination notice',
  description: "Sent to a tenant's admin when the workspace is scheduled for deletion",
  variables: z.object({ tenantName: z.string(), terminationDate: z.string().describe('Deletion date, YYYY-MM-DD') }),
  sample: { tenantName: 'Acme', terminationDate: '2027-01-31' },
  defaults: {
    en: {
      subject: 'Account termination notice — {{tenantName}}',
      html: `<p>Your account <strong>{{tenantName}}</strong> has been scheduled for termination.</p>
<p>All data will be permanently deleted on <strong>{{terminationDate}}</strong>.</p>
<p>Please export your data before this date if you need it.</p>`,
    },
    id: {
      subject: 'Pemberitahuan penghentian akun — {{tenantName}}',
      html: `<p>Akun <strong>{{tenantName}}</strong> Anda dijadwalkan untuk dihentikan.</p>
<p>Semua data akan dihapus permanen pada <strong>{{terminationDate}}</strong>.</p>
<p>Silakan ekspor data Anda sebelum tanggal tersebut jika diperlukan.</p>`,
    },
  },
});

const contactSales = defineEmail({
  key: 'core.contact-sales',
  scope: 'platform',
  name: 'Contact sales request',
  description: 'Sent to the sales team when someone fills in the Contact Sales form',
  variables: z.object({
    companyName: z.string(),
    contactName: z.string(),
    email: z.string(),
    phone: z.string(),
    employees: z.string(),
    message: z.string().optional(),
  }),
  sample: { companyName: 'Acme', contactName: 'Budi', email: 'budi@acme.example', phone: '+62 812 0000', employees: '10-50', message: 'We would like a demo.' },
  defaults: {
    en: {
      subject: 'New tenant registration request — {{companyName}}',
      html: `<h2 ${H2}>New tenant registration request</h2>
<p>A potential customer submitted the Contact Sales form:</p>
<table cellpadding="4" cellspacing="0">
<tr><td><strong>Company</strong></td><td>{{companyName}}</td></tr>
<tr><td><strong>Contact</strong></td><td>{{contactName}}</td></tr>
<tr><td><strong>Email</strong></td><td><a href="mailto:{{email}}">{{email}}</a></td></tr>
<tr><td><strong>Phone</strong></td><td>{{phone}}</td></tr>
<tr><td><strong>Company size</strong></td><td>{{employees}}</td></tr>
</table>
{{#if message}}<p><strong>Message:</strong></p><p>{{message}}</p>{{/if}}`,
    },
    id: {
      subject: 'Permintaan pendaftaran tenant baru — {{companyName}}',
      html: `<h2 ${H2}>Permintaan pendaftaran tenant baru</h2>
<p>Calon pelanggan mengisi formulir Hubungi Sales:</p>
<table cellpadding="4" cellspacing="0">
<tr><td><strong>Perusahaan</strong></td><td>{{companyName}}</td></tr>
<tr><td><strong>Kontak</strong></td><td>{{contactName}}</td></tr>
<tr><td><strong>Email</strong></td><td><a href="mailto:{{email}}">{{email}}</a></td></tr>
<tr><td><strong>Telepon</strong></td><td>{{phone}}</td></tr>
<tr><td><strong>Ukuran perusahaan</strong></td><td>{{employees}}</td></tr>
</table>
{{#if message}}<p><strong>Pesan:</strong></p><p>{{message}}</p>{{/if}}`,
    },
  },
});

/** The emails core sends. Plugins declare theirs in their own `src/emails.ts`. */
export const CoreEmails: EmailDefinition[] = [
  passwordReset,
  tenantWelcome,
  tenantSuspended,
  tenantReactivated,
  tenantTerminated,
  contactSales,
  ...BillingEmails,
];
