import { CALENDAR_SCOPE, createGoogleApi, GoogleApiError, IDENTITY_SCOPES, MEET_SCOPE, type GoogleEventBody } from './google-api';
import type { GoogleCalendarConfig } from './google-calendar.config';

const config: GoogleCalendarConfig = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-client-secret-value',
  encryptionKey: 'unused',
  redirectUri: 'https://app.test/plugins/integration/google-calendar/callback',
  appName: 'Acme',
  configured: true,
};

const ACCESS = 'ya29.access-token-value';
const REFRESH = '1//refresh-token-value';

type Scripted = { status: number; body?: unknown } | Error;
interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

function fakeFetch(...responses: Scripted[]) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    const text = next.body === undefined ? '' : JSON.stringify(next.body);
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => text };
  });
  return { api: createGoogleApi(config, fetchImpl), calls };
}

const idToken = (payload: object) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'signature'].join('.');

const body: GoogleEventBody = {
  summary: 'Published: Hello',
  start: { dateTime: '2026-11-02T09:00:00.000Z', timeZone: 'Asia/Jakarta' },
  end: { dateTime: '2026-11-02T09:30:00.000Z', timeZone: 'Asia/Jakarta' },
};

async function caught(promise: Promise<unknown>): Promise<GoogleApiError> {
  try {
    await promise;
  } catch (error) {
    return error as GoogleApiError;
  }
  throw new Error('expected a rejection');
}

describe('GoogleApi', () => {
  it('authUrl has client_id, redirect_uri, the three scopes, access_type=offline, prompt=consent, include_granted_scopes, state, S256 challenge', () => {
    const url = new URL(fakeFetch().api.authUrl('state-abc', 'challenge-xyz', [...IDENTITY_SCOPES, CALENDAR_SCOPE]));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const params = Object.fromEntries(url.searchParams);
    expect(params).toEqual({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/calendar.app.created',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: 'state-abc',
      code_challenge: 'challenge-xyz',
      code_challenge_method: 'S256',
    });
  });

  it('exchangeCode posts code + verifier + secret and reads sub/email from the id_token', async () => {
    const { api, calls } = fakeFetch({
      status: 200,
      body: {
        access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599,
        scope: 'openid https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/userinfo.email',
        id_token: idToken({ sub: '1234567890', email: 'ann@gmail.test' }),
      },
    });

    const before = Date.now();
    const result = await api.exchangeCode('auth-code', 'verifier-1');

    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0].method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      code_verifier: 'verifier-1',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    });
    expect(result).toMatchObject({ refreshToken: REFRESH, accessToken: ACCESS, sub: '1234567890', email: 'ann@gmail.test' });
    expect(result.scopes).toContain('calendar.app.created');
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3599_000);
  });

  it('exchangeCode reports a missing refresh token as null', async () => {
    const { api } = fakeFetch({
      status: 200,
      body: { access_token: ACCESS, expires_in: 3599, scope: 'openid', id_token: idToken({ sub: '1', email: 'a@b.test' }) },
    });

    expect((await api.exchangeCode('c', 'v')).refreshToken).toBeNull();
  });

  it('exchangeCode without an id_token is REJECTED', async () => {
    const { api } = fakeFetch({ status: 200, body: { access_token: ACCESS, expires_in: 3599, scope: 'openid' } });

    expect((await caught(api.exchangeCode('c', 'v'))).code).toBe('REJECTED');
  });

  it('refresh posts the refresh token and maps invalid_grant to INVALID_GRANT', async () => {
    const ok = fakeFetch({ status: 200, body: { access_token: ACCESS, expires_in: 3599 } });
    await expect(ok.api.refreshAccessToken(REFRESH)).resolves.toMatchObject({ accessToken: ACCESS });
    expect(Object.fromEntries(new URLSearchParams(ok.calls[0].body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: REFRESH });

    const revoked = fakeFetch({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } });
    const error = await caught(revoked.api.refreshAccessToken(REFRESH));
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error.code).toBe('INVALID_GRANT');
  });

  it('429, 503, 403 rateLimitExceeded and a network failure are RETRYABLE', async () => {
    const rateLimited = { error: { code: 403, message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } };
    const { api } = fakeFetch({ status: 429, body: {} }, { status: 503 }, { status: 403, body: rateLimited }, new TypeError('fetch failed'));

    for (let i = 0; i < 4; i++) {
      expect((await caught(api.createCalendar(ACCESS, 'Cal', 'UTC'))).code).toBe('RETRYABLE');
    }
  });

  it("a token-endpoint invalid_client (the platform's secret) is REJECTED, never UNAUTHORIZED", async () => {
    const { api } = fakeFetch(
      { status: 401, body: { error: 'invalid_client', error_description: 'The OAuth client was not found.' } },
      { status: 400, body: { error: 'unauthorized_client', error_description: 'Unauthorized' } },
    );

    expect((await caught(api.refreshAccessToken(REFRESH))).code).toBe('REJECTED');
    expect((await caught(api.refreshAccessToken(REFRESH))).code).toBe('REJECTED');
  });

  it('a 401 is UNAUTHORIZED', async () => {
    const { api } = fakeFetch({ status: 401, body: { error: { code: 401, message: 'Invalid Credentials' } } });

    expect((await caught(api.calendarExists(ACCESS, 'cal-1'))).code).toBe('UNAUTHORIZED');
  });

  it('a 400 with a message is REJECTED with that message', async () => {
    const { api } = fakeFetch({ status: 400, body: { error: { code: 400, message: 'Bad Request: invalid time zone' } } });

    const error = await caught(api.createCalendar(ACCESS, 'Cal', 'Mars/Olympus'));
    expect(error.code).toBe('REJECTED');
    expect(error.status).toBe(400);
    expect(error.message).toContain('Bad Request: invalid time zone');
  });

  it('error messages never contain the access token, refresh token or client secret', async () => {
    // Each request's own secrets echoed back by Google
    const echo = { error: { code: 400, message: `bad ${ACCESS} ${config.clientSecret}` } };
    const { api } = fakeFetch(
      { status: 400, body: echo },
      { status: 400, body: { error: 'invalid_request', error_description: `bad ${REFRESH} ${config.clientSecret}` } },
      new TypeError(`connect failed for https://oauth2.googleapis.com/token?client_secret=${config.clientSecret}`),
    );

    const errors = [
      await caught(api.createCalendar(ACCESS, 'Cal', 'UTC')),
      await caught(api.refreshAccessToken(REFRESH)),
      await caught(api.refreshAccessToken(REFRESH)),
    ];
    for (const error of errors) {
      expect(error.message).not.toContain(ACCESS);
      expect(error.message).not.toContain(REFRESH);
      expect(error.message).not.toContain(config.clientSecret);
    }
  });

  it('putEvent updates by id; on 404 inserts with that id; an insert 409 falls back to update', async () => {
    const updated = fakeFetch({ status: 200, body: { id: 'ev1' } });
    await updated.api.putEvent(ACCESS, 'cal@group.calendar.google.com', 'ev1', body);
    expect(updated.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PUT https://www.googleapis.com/calendar/v3/calendars/cal%40group.calendar.google.com/events/ev1?conferenceDataVersion=1',
    ]);
    expect(updated.calls[0].headers.Authorization).toBe(`Bearer ${ACCESS}`);

    const inserted = fakeFetch({ status: 404, body: { error: { code: 404, message: 'Not Found' } } }, { status: 200, body: { id: 'ev1' } });
    await inserted.api.putEvent(ACCESS, 'cal-1', 'ev1', body);
    expect(inserted.calls.map((c) => c.method)).toEqual(['PUT', 'POST']);
    expect(inserted.calls[1].url).toBe('https://www.googleapis.com/calendar/v3/calendars/cal-1/events?conferenceDataVersion=1');
    expect(JSON.parse(inserted.calls[1].body)).toMatchObject({ id: 'ev1', summary: 'Published: Hello' });

    const raced = fakeFetch(
      { status: 404, body: {} },
      { status: 409, body: { error: { code: 409, message: 'The requested identifier already exists.' } } },
      { status: 200, body: { id: 'ev1' } },
    );
    await raced.api.putEvent(ACCESS, 'cal-1', 'ev1', body);
    expect(raced.calls.map((c) => c.method)).toEqual(['PUT', 'POST', 'PUT']);
  });

  it("putEvent sends the event's conferencing, on updates and inserts alike", async () => {
    const conferenceData = {
      conferenceSolution: { key: { type: 'hangoutsMeet' as const } },
      entryPoints: [{ entryPointType: 'video' as const, uri: 'https://meet.google.com/abc-defg-hij', label: 'meet.google.com/abc-defg-hij' }],
    };
    const { api, calls } = fakeFetch({ status: 404, body: {} }, { status: 200, body: { id: 'ev1' } });

    await api.putEvent(ACCESS, 'cal-1', 'ev1', { ...body, conferenceData });

    // Without conferenceDataVersion=1 Google ignores conferenceData: no Meet is set, replaced or cleared
    expect(calls.map((c) => new URL(c.url).searchParams.get('conferenceDataVersion'))).toEqual(['1', '1']);
    expect(calls.map((c) => JSON.parse(c.body).conferenceData)).toEqual([conferenceData, conferenceData]);
  });

  it('putEvent sends status confirmed, so an event deleted earlier comes back', async () => {
    const { api, calls } = fakeFetch({ status: 200, body: { id: 'ev1' } });

    await api.putEvent(ACCESS, 'cal-1', 'ev1', body);

    expect(JSON.parse(calls[0].body)).toMatchObject({ status: 'confirmed', summary: 'Published: Hello' });
  });

  it('putEvent on a 410 (event deleted) inserts like a 404', async () => {
    const { api, calls } = fakeFetch({ status: 410, body: { error: { code: 410, message: 'Resource has been deleted' } } }, { status: 200, body: { id: 'ev1' } });

    await api.putEvent(ACCESS, 'cal-1', 'ev1', body);

    expect(calls.map((c) => c.method)).toEqual(['PUT', 'POST']);
  });

  it('putEvent on a missing calendar is NOT_FOUND', async () => {
    const { api } = fakeFetch({ status: 404, body: {} }, { status: 404, body: { error: { code: 404, message: 'Not Found' } } });

    expect((await caught(api.putEvent(ACCESS, 'gone', 'ev1', body))).code).toBe('NOT_FOUND');
  });

  it('deleteEvent treats 404 and 410 as done', async () => {
    const { api, calls } = fakeFetch({ status: 204 }, { status: 404, body: {} }, { status: 410, body: {} });

    await api.deleteEvent(ACCESS, 'cal-1', 'ev1');
    await api.deleteEvent(ACCESS, 'cal-1', 'ev1');
    await api.deleteEvent(ACCESS, 'cal-1', 'ev1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain('DELETE https://www.googleapis.com/calendar/v3/calendars/cal-1/events/ev1');
  });

  it('createCalendar posts summary and timeZone and returns the id', async () => {
    const { api, calls } = fakeFetch({ status: 200, body: { id: 'new-cal@group.calendar.google.com', summary: 'Acme (via Acme)' } });

    await expect(api.createCalendar(ACCESS, 'Acme (via Acme)', 'Asia/Jakarta')).resolves.toBe('new-cal@group.calendar.google.com');
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://www.googleapis.com/calendar/v3/calendars' });
    expect(JSON.parse(calls[0].body)).toEqual({ summary: 'Acme (via Acme)', timeZone: 'Asia/Jakarta' });
  });

  it('calendarExists is true for 200 and false for 404; deleteCalendar treats 404 as done', async () => {
    const { api } = fakeFetch({ status: 200, body: { id: 'cal-1' } }, { status: 404, body: {} }, { status: 404, body: {} });

    await expect(api.calendarExists(ACCESS, 'cal-1')).resolves.toBe(true);
    await expect(api.calendarExists(ACCESS, 'cal-1')).resolves.toBe(false);
    await expect(api.deleteCalendar(ACCESS, 'cal-1')).resolves.toBeUndefined();
  });

  it('revoke posts the token; a token that is already invalid counts as revoked', async () => {
    const { api, calls } = fakeFetch({ status: 200, body: {} }, { status: 400, body: { error: 'invalid_token' } });

    await api.revoke(REFRESH);
    await expect(api.revoke(REFRESH)).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://oauth2.googleapis.com/revoke' });
    expect(new URLSearchParams(calls[0].body).get('token')).toBe(REFRESH);
  });

  describe('Meet', () => {
    const SPACE = 'spaces/jQCFfuBOdN5z';

    it('authUrl requests exactly the scopes it is given', () => {
      const url = new URL(fakeFetch().api.authUrl('s', 'c', [...IDENTITY_SCOPES, MEET_SCOPE]));

      expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/meetings.space.created');
    });

    it('createSpace posts the access type and returns name and meetingUri; it never returns the meeting code', async () => {
      const { api, calls } = fakeFetch({
        status: 200,
        body: { name: SPACE, meetingUri: 'https://meet.google.com/abc-mnop-xyz', meetingCode: 'abc-mnop-xyz', config: { accessType: 'TRUSTED' } },
      });

      const space = await api.createSpace(ACCESS, 'TRUSTED');

      expect(space).toEqual({ name: SPACE, meetingUri: 'https://meet.google.com/abc-mnop-xyz' });
      expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://meet.googleapis.com/v2/spaces' });
      expect(calls[0].headers.Authorization).toBe(`Bearer ${ACCESS}`);
      expect(JSON.parse(calls[0].body as string)).toEqual({ config: { accessType: 'TRUSTED' } });
    });

    it('createSpace without a name or meetingUri in the answer is REJECTED', async () => {
      const { api } = fakeFetch({ status: 200, body: { config: {} } });
      expect((await caught(api.createSpace(ACCESS, 'OPEN'))).code).toBe('REJECTED');
    });

    it("createSpace whose link isn't a meet.google.com link, or whose name isn't a space, is REJECTED", async () => {
      for (const body of [
        { name: SPACE, meetingUri: 'https://evil.test/abc-mnop-xyz' },
        { name: SPACE, meetingUri: 'http://meet.google.com/abc-mnop-xyz' },
        { name: SPACE, meetingUri: 'https://meet.google.com.evil.test/abc-mnop-xyz' },
        { name: SPACE, meetingUri: 'javascript:alert(1)//https://meet.google.com/abc' },
        { name: 'calendars/abc', meetingUri: 'https://meet.google.com/abc-mnop-xyz' },
      ]) {
        const { api } = fakeFetch({ status: 200, body });
        expect((await caught(api.createSpace(ACCESS, 'OPEN'))).code).toBe('REJECTED');
      }
    });

    it('lock calls give up after 5 s; other calls wait 15 s', async () => {
      jest.useFakeTimers();
      try {
        // A Google that never answers until the request is aborted
        const hanging = jest.fn(
          (_url: string, init: { signal?: AbortSignal } = {}) =>
            new Promise<never>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
        );
        const api = createGoogleApi(config, hanging as any);
        const settled = (promise: Promise<unknown>) => {
          const state = { done: false, error: undefined as unknown };
          promise.catch((error) => Object.assign(state, { done: true, error }));
          return state;
        };

        const patch = settled(api.setSpaceAccess(ACCESS, SPACE, 'RESTRICTED'));
        const end = settled(api.endActiveConference(ACCESS, SPACE));
        const create = settled(api.createSpace(ACCESS, 'TRUSTED'));
        await jest.advanceTimersByTimeAsync(5_000);
        expect(patch).toMatchObject({ done: true, error: expect.objectContaining({ code: 'RETRYABLE' }) });
        expect(end).toMatchObject({ done: true, error: expect.objectContaining({ code: 'RETRYABLE' }) });
        expect(create.done).toBe(false);
        await jest.advanceTimersByTimeAsync(10_000);
        expect(create).toMatchObject({ done: true, error: expect.objectContaining({ code: 'RETRYABLE' }) });
      } finally {
        jest.useRealTimers();
      }
    });

    it('setSpaceAccess patches config.accessType with the update mask', async () => {
      const { api, calls } = fakeFetch({ status: 200, body: { name: SPACE } });

      await api.setSpaceAccess(ACCESS, SPACE, 'RESTRICTED');

      expect(calls[0]).toMatchObject({ method: 'PATCH', url: `https://meet.googleapis.com/v2/${SPACE}?updateMask=config.accessType` });
      expect(JSON.parse(calls[0].body as string)).toEqual({ config: { accessType: 'RESTRICTED' } });
    });

    it('endActiveConference treats 404 and FAILED_PRECONDITION as done; 503 is RETRYABLE', async () => {
      const { api, calls } = fakeFetch(
        { status: 200, body: {} },
        { status: 404, body: { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } } },
        { status: 400, body: { error: { code: 400, message: 'No active conference', status: 'FAILED_PRECONDITION' } } },
        { status: 409, body: { error: { code: 409, message: 'No active conference', status: 'FAILED_PRECONDITION' } } },
        { status: 503, body: {} },
      );

      for (let i = 0; i < 4; i++) await expect(api.endActiveConference(ACCESS, SPACE)).resolves.toBeUndefined();
      expect((await caught(api.endActiveConference(ACCESS, SPACE))).code).toBe('RETRYABLE');
      expect(calls[0]).toMatchObject({ method: 'POST', url: `https://meet.googleapis.com/v2/${SPACE}:endActiveConference` });
    });

    it('a malformed space name is REJECTED without a request', async () => {
      const { api, calls } = fakeFetch();

      for (const bad of ['spaces/../users', 'spaces/a b', 'calendars/x', 'spaces/']) {
        expect((await caught(api.setSpaceAccess(ACCESS, bad, 'RESTRICTED'))).code).toBe('REJECTED');
        expect((await caught(api.endActiveConference(ACCESS, bad))).code).toBe('REJECTED');
      }
      expect(calls).toHaveLength(0);
    });

    it('Meet error messages never contain the access token or client secret', async () => {
      const echo = { error: { code: 400, message: `bad ${ACCESS} ${config.clientSecret}`, status: 'INVALID_ARGUMENT' } };
      const { api } = fakeFetch({ status: 400, body: echo }, { status: 400, body: echo });

      for (const error of [await caught(api.createSpace(ACCESS, 'OPEN')), await caught(api.setSpaceAccess(ACCESS, SPACE, 'OPEN'))]) {
        expect(error.code).toBe('REJECTED');
        expect(error.message).not.toContain(ACCESS);
        expect(error.message).not.toContain(config.clientSecret);
      }
    });
  });
});
