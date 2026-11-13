import { googleCalendarConfigFromEnv } from './google-calendar.config';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('googleCalendarConfigFromEnv', () => {
  it('is configured only with a client id, a client secret and a 32-byte key', () => {
    const full = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', INTEGRATION_ENCRYPTION_KEY: KEY };

    expect(googleCalendarConfigFromEnv(full).configured).toBe(true);
    expect(googleCalendarConfigFromEnv({ ...full, GOOGLE_CLIENT_ID: '' }).configured).toBe(false);
    expect(googleCalendarConfigFromEnv({ ...full, GOOGLE_CLIENT_SECRET: undefined }).configured).toBe(false);
    expect(googleCalendarConfigFromEnv({ ...full, INTEGRATION_ENCRYPTION_KEY: undefined }).configured).toBe(false);
    expect(googleCalendarConfigFromEnv({ ...full, INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }).configured).toBe(false);
  });

  it('builds the redirect URI from FRONTEND_URL and the app name from MAIL_FROM_NAME', () => {
    const config = googleCalendarConfigFromEnv({ FRONTEND_URL: 'https://app.test/', MAIL_FROM_NAME: 'Acme Cloud' });

    expect(config.redirectUri).toBe('https://app.test/plugins/integration/google-calendar/callback');
    expect(config.appName).toBe('Acme Cloud');
    expect(googleCalendarConfigFromEnv({}).appName).toBe('SaaS');
    expect(googleCalendarConfigFromEnv({}).redirectUri).toBe('http://localhost:3000/plugins/integration/google-calendar/callback');
  });
});
