import type { MeetingAccess } from '@saas/backend';
import type { GoogleCalendarConfig } from './google-calendar.config';

export const GOOGLE_API = Symbol('GOOGLE_API');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const MEET_API = 'https://meet.googleapis.com/v2';
/** Who the user is: always requested */
export const IDENTITY_SCOPES = ['openid', 'email'];
/** The app's own secondary calendars and their events */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
/** Meet spaces the app created */
export const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
/** `spaces/{id}`: anything else is refused before it can reach a URL path */
const SPACE_NAME = /^spaces\/[A-Za-z0-9_-]+$/;
/** A meeting's join link: shown to users and put in calendars, so only ever a Meet link */
export const MEET_LINK = /^https:\/\/meet\.google\.com\/[A-Za-z0-9_-]+$/;
const TIMEOUT_MS = 15_000;
/** Locking runs while someone waits (disconnect, offboarding, cancel): it gives up sooner and is retried */
const LOCK_TIMEOUT_MS = 5_000;
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

export interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  extendedProperties?: { private?: Record<string, string> };
  source?: { title: string; url: string };
  /** The event's video meeting: Calendar shows it as the event's Google Meet */
  conferenceData?: {
    conferenceSolution: { key: { type: 'hangoutsMeet' } };
    entryPoints: Array<{ entryPointType: 'video'; uri: string; label?: string }>;
  };
}

export type GoogleApiErrorCode = 'RETRYABLE' | 'INVALID_GRANT' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'REJECTED';

/** Messages never carry request bodies, URLs or tokens: they end up in logs and sync records. */
export class GoogleApiError extends Error {
  constructor(
    readonly code: GoogleApiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

export interface GoogleTokens {
  /** Null when Google didn't issue one (the account had already consented without prompt=consent) */
  refreshToken: string | null;
  accessToken: string;
  expiresAt: number;
  /** The Google account's stable id */
  sub: string;
  email: string;
  scopes: string;
}

export interface GoogleApi {
  /** Google's consent URL asking for exactly `scopes` (earlier grants are kept) */
  authUrl(state: string, codeChallenge: string, scopes: string[]): string;
  exchangeCode(code: string, codeVerifier: string): Promise<GoogleTokens>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }>;
  /** Revokes every token of this Google account for the platform's OAuth client */
  revoke(token: string): Promise<void>;
  createCalendar(accessToken: string, summary: string, timeZone: string): Promise<string>;
  calendarExists(accessToken: string, calendarId: string): Promise<boolean>;
  deleteCalendar(accessToken: string, calendarId: string): Promise<void>;
  /** Creates or replaces the event with this id (restoring it if it was deleted in Google) */
  putEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<void>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  /** A new Meet space; the meeting code is not returned because it must not be stored */
  createSpace(accessToken: string, access: MeetingAccess): Promise<{ name: string; meetingUri: string }>;
  setSpaceAccess(accessToken: string, spaceName: string, access: MeetingAccess): Promise<void>;
  /** Ends the meeting in progress in the space, if there is one */
  endActiveConference(accessToken: string, spaceName: string): Promise<void>;
}

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface GoogleResponse {
  ok: boolean;
  status: number;
  json: any;
}

const parse = (text: string): any => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

function idTokenClaims(idToken: unknown): { sub?: string; email?: string } {
  if (typeof idToken !== 'string') return {};
  // Received over TLS straight from Google's token endpoint, so its signature needn't be checked
  return parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) ?? {};
}

export function createGoogleApi(config: GoogleCalendarConfig, fetchImpl: FetchLike = fetch): GoogleApi {
  /** Everything a message must never contain, longest first so a token inside another is fully hidden */
  const redact = (message: string, secrets: Array<string | null | undefined>) =>
    [config.clientSecret, ...secrets]
      .filter((secret): secret is string => !!secret && secret.length >= 6)
      .sort((a, b) => b.length - a.length)
      .reduce((text, secret) => text.split(secret).join('[redacted]'), message)
      .slice(0, 500);

  async function request(action: string, url: string, init: FetchInit, timeoutMs = TIMEOUT_MS): Promise<GoogleResponse> {
    // A timer rather than AbortSignal.timeout(): it also covers reading the body, and tests can drive it
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('The request took too long', 'TimeoutError')), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      return { ok: response.ok, status: response.status, json: parse(await response.text()) };
    } catch (error) {
      // fetch errors can quote the URL: report only their kind
      const kind = (error as { cause?: { code?: string } })?.cause?.code ?? (error as Error)?.name ?? 'error';
      throw new GoogleApiError('RETRYABLE', 0, `${action}: could not reach Google (${kind})`);
    } finally {
      clearTimeout(timer);
    }
  }

  function failure(action: string, response: GoogleResponse, secrets: Array<string | null | undefined>): GoogleApiError {
    const { status, json } = response;
    const apiError = json && typeof json.error === 'object' ? json.error : null;
    const reason = apiError?.errors?.[0]?.reason;
    const say = (code: GoogleApiErrorCode, text: string) => new GoogleApiError(code, status, redact(`${action}: ${text}`, secrets));

    if (status === 429 || status >= 500 || (status === 403 && RATE_LIMIT_REASONS.has(reason))) return say('RETRYABLE', `Google is busy (HTTP ${status})`);
    if (json?.error === 'invalid_grant') return say('INVALID_GRANT', 'Google access was revoked or has expired');
    // The platform's OAuth client, not the user's grant (wrong or rotated secret, deleted client)
    if (json?.error === 'invalid_client' || json?.error === 'unauthorized_client') {
      return say('REJECTED', 'Google rejected the OAuth client: check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
    }
    if (status === 401) return say('UNAUTHORIZED', 'Google did not accept the credentials');
    if (status === 404 || status === 410) return say('NOT_FOUND', 'not found in Google');
    const detail = apiError?.message ?? json?.error_description ?? (typeof json?.error === 'string' ? json.error : null);
    return say('REJECTED', detail ? String(detail) : `HTTP ${status}`);
  }

  async function tokenRequest(action: string, params: Record<string, string>, secrets: string[]): Promise<any> {
    const response = await request(
      action,
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...params, client_id: config.clientId ?? '', client_secret: config.clientSecret ?? '' }).toString(),
      },
    );
    if (!response.ok) throw failure(action, response, secrets);
    return response.json ?? {};
  }

  async function calendarRequest(action: string, accessToken: string, method: string, path: string, body?: unknown): Promise<GoogleResponse> {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return request(action, `${CALENDAR_API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  async function meetRequest(action: string, accessToken: string, method: string, path: string, body: unknown, timeoutMs?: number): Promise<GoogleResponse> {
    return request(
      action,
      `${MEET_API}${path}`,
      { method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      timeoutMs,
    );
  }

  function assertSpaceName(action: string, spaceName: string): void {
    if (!SPACE_NAME.test(spaceName)) throw new GoogleApiError('REJECTED', 0, `${action}: not a Meet space name`);
  }

  const calendarPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}`;
  const eventPath = (calendarId: string, eventId: string) => `${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const isGone = (status: number) => status === 404 || status === 410;

  return {
    authUrl(state, codeChallenge, scopes) {
      const params = new URLSearchParams({
        client_id: config.clientId ?? '',
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return `${AUTH_URL}?${params}`;
    },

    async exchangeCode(code, codeVerifier) {
      const action = 'Connecting Google';
      const json = await tokenRequest(
        action,
        { grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: config.redirectUri },
        [code, codeVerifier],
      );
      const claims = idTokenClaims(json.id_token);
      if (typeof json.access_token !== 'string' || !claims.sub) {
        throw new GoogleApiError('REJECTED', 200, `${action}: Google did not return the account`);
      }
      return {
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
        accessToken: json.access_token,
        expiresAt: Date.now() + Number(json.expires_in ?? 0) * 1000,
        sub: claims.sub,
        email: claims.email ?? '',
        scopes: typeof json.scope === 'string' ? json.scope : '',
      };
    },

    async refreshAccessToken(refreshToken) {
      const action = 'Refreshing Google access';
      const json = await tokenRequest(action, { grant_type: 'refresh_token', refresh_token: refreshToken }, [refreshToken]);
      if (typeof json.access_token !== 'string') throw new GoogleApiError('REJECTED', 200, `${action}: Google returned no access token`);
      return { accessToken: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 0) * 1000 };
    },

    async revoke(token) {
      const action = 'Revoking Google access';
      const response = await request(
        action,
        REVOKE_URL,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() },
      );
      // An invalid token has nothing left to revoke
      if (response.ok || (response.status === 400 && response.json?.error === 'invalid_token')) return;
      throw failure(action, response, [token]);
    },

    async createCalendar(accessToken, summary, timeZone) {
      const action = 'Creating the calendar';
      const response = await calendarRequest(action, accessToken, 'POST', '/calendars', { summary, timeZone });
      if (!response.ok) throw failure(action, response, [accessToken]);
      if (typeof response.json?.id !== 'string') throw new GoogleApiError('REJECTED', response.status, `${action}: Google returned no calendar id`);
      return response.json.id;
    },

    async calendarExists(accessToken, calendarId) {
      const action = 'Checking the calendar';
      const response = await calendarRequest(action, accessToken, 'GET', calendarPath(calendarId));
      if (response.ok) return true;
      if (isGone(response.status)) return false;
      throw failure(action, response, [accessToken]);
    },

    async deleteCalendar(accessToken, calendarId) {
      const action = 'Deleting the calendar';
      const response = await calendarRequest(action, accessToken, 'DELETE', calendarPath(calendarId));
      if (!response.ok && !isGone(response.status)) throw failure(action, response, [accessToken]);
    },

    async putEvent(accessToken, calendarId, eventId, body) {
      const action = 'Saving the event';
      // An event deleted in Google stays as "cancelled" under its id: confirming restores it
      const event = { ...body, status: 'confirmed' };
      // Without it Google ignores conferenceData: the event's Meet is set, replaced and cleared only with it
      const withConferencing = '?conferenceDataVersion=1';
      const update = () => calendarRequest(action, accessToken, 'PUT', `${eventPath(calendarId, eventId)}${withConferencing}`, event);

      let response = await update();
      if (isGone(response.status)) {
        response = await calendarRequest(action, accessToken, 'POST', `${calendarPath(calendarId)}/events${withConferencing}`, { ...event, id: eventId });
        // Another attempt inserted it meanwhile
        if (response.status === 409) response = await update();
      }
      if (!response.ok) throw failure(action, response, [accessToken]);
    },

    async deleteEvent(accessToken, calendarId, eventId) {
      const action = 'Deleting the event';
      const response = await calendarRequest(action, accessToken, 'DELETE', eventPath(calendarId, eventId));
      if (!response.ok && !isGone(response.status)) throw failure(action, response, [accessToken]);
    },

    async createSpace(accessToken, access) {
      const action = 'Creating the meeting';
      const response = await meetRequest(action, accessToken, 'POST', '/spaces', { config: { accessType: access } });
      if (!response.ok) throw failure(action, response, [accessToken]);
      const { name, meetingUri } = response.json ?? {};
      if (typeof name !== 'string' || !SPACE_NAME.test(name) || typeof meetingUri !== 'string' || !MEET_LINK.test(meetingUri)) {
        throw new GoogleApiError('REJECTED', response.status, `${action}: Google returned no usable meeting`);
      }
      return { name, meetingUri };
    },

    async setSpaceAccess(accessToken, spaceName, access) {
      const action = 'Changing who can join the meeting';
      assertSpaceName(action, spaceName);
      const response = await meetRequest(action, accessToken, 'PATCH', `/${spaceName}?updateMask=config.accessType`, { config: { accessType: access } }, LOCK_TIMEOUT_MS);
      if (!response.ok) throw failure(action, response, [accessToken]);
    },

    async endActiveConference(accessToken, spaceName) {
      const action = 'Ending the meeting in progress';
      assertSpaceName(action, spaceName);
      const response = await meetRequest(action, accessToken, 'POST', `/${spaceName}:endActiveConference`, {}, LOCK_TIMEOUT_MS);
      // No meeting in progress (or no such space) means there is nothing to end
      const nothingToEnd = response.status === 404 || response.json?.error?.status === 'FAILED_PRECONDITION';
      if (!response.ok && !nothingToEnd) throw failure(action, response, [accessToken]);
    },
  };
}
