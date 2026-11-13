import { seedAdminPassword, validateEnv } from './env.config';

const REQUIRED = { DATABASE_URL: 'postgresql://u:p@localhost:5435/db', JWT_SECRET: 'secret' };

describe('validateEnv', () => {
  // With `validate`, @nestjs/config copies only the RETURNED object into process.env:
  // a variable the schema doesn't declare is silently dropped, even when .env sets it.
  it.each([
    ['BILLING_PROVIDER', 'fake'],
    ['BILLING_CALLBACK_TOKEN', 'token'],
    ['BILLING_FAKE_ALLOWED', 'true'],
    ['MAIL_FROM_NAME', 'SaaS Admin'],
    ['SALES_EMAIL', 'sales@example.com'],
  ])('keeps %s (read directly from process.env)', (key, value) => {
    expect(validateEnv({ ...REQUIRED, [key]: value })).toMatchObject({ [key]: value });
  });

  it('leaves the billing variables unset when .env does not set them (no default provider)', () => {
    const env = validateEnv({ ...REQUIRED });
    expect(env.BILLING_PROVIDER).toBeUndefined();
    expect(env.BILLING_FAKE_ALLOWED).toBeUndefined();
  });

  it('defaults API_PUBLIC_URL and EMAIL_LOG_RETENTION_DAYS', () => {
    const env = validateEnv({ ...REQUIRED });
    expect(env.API_PUBLIC_URL).toBe('http://localhost:3001');
    expect(env.EMAIL_LOG_RETENTION_DAYS).toBe(90);
  });

  it('keeps SMTP_* and API_PUBLIC_URL', () => {
    const env = validateEnv({
      ...REQUIRED, SMTP_HOST: 'smtp.test', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', API_PUBLIC_URL: 'https://api.test', EMAIL_LOG_RETENTION_DAYS: '30',
    });
    expect(env).toMatchObject({ SMTP_HOST: 'smtp.test', SMTP_PORT: 465, SMTP_USER: 'u', SMTP_PASS: 'p', API_PUBLIC_URL: 'https://api.test', EMAIL_LOG_RETENTION_DAYS: 30 });
  });

  it('keeps GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and INTEGRATION_ENCRYPTION_KEY', () => {
    const env = validateEnv({ ...REQUIRED, GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret', INTEGRATION_ENCRYPTION_KEY: 'a2V5' });
    expect(env).toMatchObject({ GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret', INTEGRATION_ENCRYPTION_KEY: 'a2V5' });
  });

  it('rejects a BILLING_FAKE_ALLOWED that is not true/false', () => {
    expect(() => validateEnv({ ...REQUIRED, BILLING_FAKE_ALLOWED: 'yes' })).toThrow('BILLING_FAKE_ALLOWED');
  });
});

describe('seedAdminPassword', () => {
  // The password `pnpm db:seed` gives admin@system
  it('is DEFAULT_ADMIN_PASSWORD', () => {
    expect(seedAdminPassword(validateEnv({ ...REQUIRED, DEFAULT_ADMIN_PASSWORD: 'from-the-env-1' }).DEFAULT_ADMIN_PASSWORD, 'development')).toBe('from-the-env-1');
  });

  it('falls back to the built-in default outside production', () => {
    expect(seedAdminPassword(validateEnv({ ...REQUIRED }).DEFAULT_ADMIN_PASSWORD, undefined)).toBe('S3cr3T!!');
  });

  it('refuses the built-in default in production: it is published in the source', () => {
    expect(() => seedAdminPassword(validateEnv({ ...REQUIRED }).DEFAULT_ADMIN_PASSWORD, 'production')).toThrow('DEFAULT_ADMIN_PASSWORD');
  });

  it('accepts a password set in .env in production', () => {
    expect(seedAdminPassword(validateEnv({ ...REQUIRED, DEFAULT_ADMIN_PASSWORD: 'a-real-secret' }).DEFAULT_ADMIN_PASSWORD, 'production')).toBe('a-real-secret');
  });
});
