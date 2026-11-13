export const GOOGLE_CALENDAR_CONFIG = Symbol('GOOGLE_CALENDAR_CONFIG');

export interface GoogleCalendarConfig {
  clientId?: string;
  clientSecret?: string;
  /** base64 of 32 bytes: seals stored refresh tokens */
  encryptionKey?: string;
  /** Must be registered on the OAuth client in the Google Cloud console */
  redirectUri: string;
  /** Names the app in calendar names and event descriptions */
  appName: string;
  /** False until all three secrets are set (and the key is 32 bytes): Google Calendar is then hidden */
  configured: boolean;
}

const value = (raw: string | undefined) => raw?.trim() || undefined;

const isKey = (key: string | undefined) => !!key && Buffer.from(key, 'base64').length === 32;

export function googleCalendarConfigFromEnv(env: Record<string, string | undefined> = process.env): GoogleCalendarConfig {
  const clientId = value(env.GOOGLE_CLIENT_ID);
  const clientSecret = value(env.GOOGLE_CLIENT_SECRET);
  const encryptionKey = value(env.INTEGRATION_ENCRYPTION_KEY);
  const frontendUrl = (value(env.FRONTEND_URL) ?? 'http://localhost:3000').replace(/\/+$/, '');
  return {
    clientId,
    clientSecret,
    encryptionKey,
    redirectUri: `${frontendUrl}/plugins/integration/google-calendar/callback`,
    appName: value(env.MAIL_FROM_NAME) ?? 'SaaS',
    configured: !!clientId && !!clientSecret && isKey(encryptionKey),
  };
}
