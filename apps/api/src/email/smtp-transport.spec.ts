const mockSendMail = jest.fn(async () => ({ messageId: '<abc@smtp.test>' }));
const mockCreateTransport = jest.fn((_options: unknown) => ({ sendMail: mockSendMail }));
jest.mock('nodemailer', () => ({ createTransport: (options: unknown) => mockCreateTransport(options) }));

import { createSmtpTransport } from './smtp-transport';
import type { EmailEnv } from './email-env';

const ENV: EmailEnv = {
  smtpHost: 'smtp.test', smtpPort: 587, smtpUser: 'user', smtpPass: 'pass',
  mailFrom: 'no-reply@saas.test', mailFromName: 'SaaS', frontendUrl: 'http://web.test', apiPublicUrl: 'http://api.test', retentionDays: 90,
};

const envelope = {
  from: { name: 'Acme "Ops"\r\nBcc: victim@x.test', address: 'no-reply@saas.test' },
  to: ['a@acme.test', 'b@acme.test'],
  replyTo: 'support@acme.test',
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
};

describe('createSmtpTransport', () => {
  beforeEach(() => {
    mockCreateTransport.mockClear();
    mockSendMail.mockClear();
  });

  it('returns null without SMTP_HOST', () => {
    expect(createSmtpTransport({ ...ENV, smtpHost: undefined })).toBeNull();
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it('returns null without MAIL_FROM', () => {
    expect(createSmtpTransport({ ...ENV, mailFrom: undefined })).toBeNull();
  });

  it('uses TLS on port 465 only', () => {
    createSmtpTransport({ ...ENV, smtpPort: 465 });
    createSmtpTransport({ ...ENV, smtpPort: 587 });

    expect(mockCreateTransport.mock.calls[0][0]).toMatchObject({ host: 'smtp.test', port: 465, secure: true });
    expect(mockCreateTransport.mock.calls[1][0]).toMatchObject({ port: 587, secure: false });
  });

  it('omits auth when SMTP_USER is empty', () => {
    createSmtpTransport({ ...ENV, smtpUser: undefined, smtpPass: undefined });
    createSmtpTransport(ENV);

    expect(mockCreateTransport.mock.calls[0][0]).not.toHaveProperty('auth');
    expect(mockCreateTransport.mock.calls[1][0]).toMatchObject({ auth: { user: 'user', pass: 'pass' } });
  });

  it('passes from as a { name, address } object (a name with quotes or newlines never becomes a raw header)', async () => {
    const transport = createSmtpTransport(ENV)!;

    await expect(transport.send(envelope)).resolves.toEqual({ messageId: '<abc@smtp.test>' });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: { name: 'Acme "Ops"\r\nBcc: victim@x.test', address: 'no-reply@saas.test' },
      to: ['a@acme.test', 'b@acme.test'],
      replyTo: 'support@acme.test',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });
});
