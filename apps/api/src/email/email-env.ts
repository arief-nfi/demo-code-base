/** Email settings, read once from the (validated) environment. */
export interface EmailEnv {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  mailFrom?: string;
  mailFromName?: string;
  frontendUrl: string;
  apiPublicUrl: string;
  retentionDays: number;
}

export const EMAIL_ENV = Symbol('EMAIL_ENV');

const value = (raw: string | undefined) => (raw && raw.trim() ? raw.trim() : undefined);

export function emailEnvFromProcess(env: NodeJS.ProcessEnv = process.env): EmailEnv {
  return {
    smtpHost: value(env.SMTP_HOST),
    smtpPort: value(env.SMTP_PORT) ? Number(env.SMTP_PORT) : undefined,
    smtpUser: value(env.SMTP_USER),
    smtpPass: env.SMTP_PASS || undefined,
    mailFrom: value(env.MAIL_FROM),
    mailFromName: value(env.MAIL_FROM_NAME),
    frontendUrl: value(env.FRONTEND_URL) ?? 'http://localhost:3000',
    apiPublicUrl: (value(env.API_PUBLIC_URL) ?? 'http://localhost:3001').replace(/\/+$/, ''),
    retentionDays: Number(env.EMAIL_LOG_RETENTION_DAYS) || 90,
  };
}
