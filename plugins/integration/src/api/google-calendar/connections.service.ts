import { BadRequestException, HttpException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  CacheService,
  CALENDAR_SYNC,
  calendarError,
  createSecretBox,
  isValidTimeZone,
  PluginEventService,
  PrismaService,
  SystemEvents,
  type CalendarConnectionEvent,
  type ICalendarSync,
  type MeetingAccess,
  type SecretBox,
} from '@saas/backend';
import { integrationConfigSchema } from '../../config.schema';
import { CALENDAR_SCOPE, GOOGLE_API, GoogleApiError, IDENTITY_SCOPES, MEET_SCOPE, type GoogleApi } from './google-api';
import { GOOGLE_CALENDAR_CONFIG, type GoogleCalendarConfig } from './google-calendar.config';
import { MeetSpacesService } from './meet-spaces.service';

const PLUGIN_KEY = 'integration';
const STATE_TTL_MS = 10 * 60_000;
/** Refresh access tokens this long before Google says they expire */
const TOKEN_MARGIN_MS = 60_000;
/** A refresh whose token is needed one last time (disconnect, offboarding) retries a busy Google this often... */
const LAST_REFRESH_DELAYS_MS = [0, 1_000, 3_000];
/** ...but starts no new try after this, so whoever waits gets an answer in seconds */
const LAST_REFRESH_BUDGET_MS = 5_000;
const EXPIRED_LINK = 'This connect link has expired. Start again.';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const stateKey = (state: string) => `gcal:state:${state}`;
/** Binds a sealed refresh token to its row: copied to another user or tenant, it won't open */
const tokenContext = (tenantSlug: string, userId: string) => `google-calendar:${tenantSlug}:${userId}`;

interface PendingConnect {
  tenantSlug: string;
  userId: string;
  verifier: string;
}

interface ConnectionRow {
  userId: string;
  externalAccountId: string;
  /** Space-separated scopes Google granted */
  scopes: string;
  accountEmail: string;
  refreshTokenEnc: string;
  calendarId: string | null;
  calendarName: string | null;
  status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'DISCONNECTED';
  lastError: string | null;
  connectedAt: Date;
}

export type GoogleFeature = 'calendar' | 'meet';
/**
 * off: the tenant has the feature switched off; needs-permission: connected but the scope isn't
 * granted; not-connected: the connection needs reconnecting or was disconnected
 */
export type FeatureState = 'ready' | 'needs-permission' | 'off' | 'not-connected';
export type FeatureStates = Record<GoogleFeature, FeatureState>;

export interface FeatureSwitches {
  calendar: boolean;
  meet: boolean;
  meetDefaultAccess: MeetingAccess;
}

const FEATURE_SCOPES: Record<GoogleFeature, string> = { calendar: CALENDAR_SCOPE, meet: MEET_SCOPE };
const FEATURE_NAMES: Record<GoogleFeature, string> = { calendar: 'Calendar', meet: 'Meet' };
/** Core's names for what a connection is used for */
export const CORE_FEATURES = { calendar: 'calendar', meet: 'meetings' } as const;
const ACCESS_TYPES: readonly MeetingAccess[] = ['TRUSTED', 'OPEN', 'RESTRICTED'];
const granted = (scopes: string, scope: string) => scopes.split(' ').includes(scope);

/** What the API shows about a connection: never a token */
export interface ConnectionView {
  status: ConnectionRow['status'];
  accountEmail: string;
  calendarName: string | null;
  connectedAt: Date;
  lastError: string | null;
  syncedEvents: number;
  features: FeatureStates;
  /** Open meetings the user hosts: disconnecting locks them, whatever the Meet switch */
  activeMeetings: number;
}

/**
 * Users' Google accounts: connecting (OAuth with PKCE and a single-use state bound to
 * the user), disconnecting, offboarding, and short-lived access tokens. Revoking at
 * Google kills every token the account gave the platform, so it happens only when no
 * other connection, in any tenant, uses the same account.
 */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);
  private readonly box: SecretBox | null;
  /** Access tokens live only here, per process; never in Redis or the database */
  private readonly accessTokens = new Map<string, { token: string; expiresAt: number; calendarId: string | null; accountId: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly events: PluginEventService,
    @Inject(GOOGLE_API) private readonly google: GoogleApi,
    @Inject(GOOGLE_CALENDAR_CONFIG) private readonly config: GoogleCalendarConfig,
    @Inject(CALENDAR_SYNC) private readonly calendarSync: ICalendarSync,
    private readonly meetSpaces: MeetSpacesService,
  ) {
    this.box = config.configured && config.encryptionKey ? createSecretBox(config.encryptionKey) : null;
  }

  /** Whether the platform has Google credentials and an encryption key */
  get configured(): boolean {
    return this.config.configured;
  }

  async myStatus(tenantSlug: string, userId: string): Promise<{
    configured: boolean;
    calendar: { enabled: boolean };
    meet: { enabled: boolean; defaultAccess: MeetingAccess };
    connection: ConnectionView | null;
  }> {
    if (!this.config.configured) {
      return { configured: false, calendar: { enabled: false }, meet: { enabled: false, defaultAccess: 'TRUSTED' }, connection: null };
    }
    const switches = await this.featureSwitches(tenantSlug);
    const row = await this.connections(tenantSlug).findUnique({ where: { userId } });
    return {
      configured: true,
      calendar: { enabled: switches.calendar },
      meet: { enabled: switches.meet, defaultAccess: switches.meetDefaultAccess },
      connection: row ? await this.view(tenantSlug, row, switches) : null,
    };
  }

  async startConnect(tenantSlug: string, userId: string): Promise<{ url: string }> {
    this.assertConfigured();
    const features = this.requestedFeatures(await this.featureSwitches(tenantSlug));
    if (features.length === 0) throw new BadRequestException('Google Calendar and Google Meet are switched off for your organization.');

    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const pending: PendingConnect = { tenantSlug, userId, verifier };
    await this.cache.set(stateKey(state), pending, STATE_TTL_MS);
    const scopes = [...IDENTITY_SCOPES, ...features.map((feature) => FEATURE_SCOPES[feature])];
    return { url: this.google.authUrl(state, createHash('sha256').update(verifier).digest('base64url'), scopes) };
  }

  async completeConnect(tenantSlug: string, userId: string, code: string, state: string): Promise<ConnectionView> {
    this.assertConfigured();
    // Read and deleted in one step: single use, whoever presents it, even with two at once
    const pending = await this.cache.take<PendingConnect>(stateKey(state));
    if (!pending) throw new BadRequestException(EXPIRED_LINK);
    if (pending.tenantSlug !== tenantSlug || pending.userId !== userId) throw new BadRequestException(EXPIRED_LINK);

    const tokens = await this.google.exchangeCode(code, pending.verifier).catch((error) => {
      throw this.httpError('Google did not accept this sign-in', error);
    });
    if (!tokens.refreshToken) {
      throw new BadRequestException(
        'Google did not grant offline access. Remove this app at https://myaccount.google.com/permissions, then connect again.',
      );
    }
    // Google's granular consent lets people untick a feature: keep what was granted, refuse only if nothing was
    const switches = await this.featureSwitches(tenantSlug);
    const requested = this.requestedFeatures(switches);
    const grantedFeatures = requested.filter((feature) => granted(tokens.scopes, FEATURE_SCOPES[feature]));
    if (grantedFeatures.length === 0) {
      const names = requested.map((feature) => FEATURE_NAMES[feature]).join(' or ');
      throw new BadRequestException(`Google didn't grant access to ${names}. Connect again and allow access.`);
    }

    const connections = this.connections(tenantSlug);
    const previous: ConnectionRow | null = await connections.findUnique({ where: { userId } });
    const switchedAccount = !!previous && previous.externalAccountId !== tokens.sub;
    if (previous && switchedAccount) {
      // The old account's meetings are locked with its own token, before that grant is revoked
      const oldToken = granted(previous.scopes, MEET_SCOPE) ? await this.freshAccessToken(tenantSlug, previous) : null;
      await this.meetSpaces.lockHostSpaces(tenantSlug, userId, oldToken, 'The host switched Google accounts');
      await this.revokeIfUnshared(tenantSlug, userId, previous);
    }
    // The previous account's calendar isn't this account's
    let calendarId: string | null = switchedAccount ? null : (previous?.calendarId ?? null);
    let calendarName: string | null = switchedAccount ? null : (previous?.calendarName ?? null);
    if (grantedFeatures.includes('calendar') && calendarId) {
      const exists = await this.google.calendarExists(tokens.accessToken, calendarId).catch((error) => {
        throw this.httpError('Could not check your calendar in Google', error);
      });
      if (!exists) calendarId = null;
    }
    if (grantedFeatures.includes('calendar') && !calendarId) {
      calendarName = `${await this.tenantName(tenantSlug)} (via ${this.config.appName})`;
      calendarId = await this.google.createCalendar(tokens.accessToken, calendarName, await this.tenantTimeZone(tenantSlug)).catch((error) => {
        throw this.httpError('Could not create the calendar in Google', error);
      });
      // A new calendar is empty: push everything the user had to it again
      await this.links(tenantSlug).updateMany({ where: { userId }, data: { status: 'PENDING', attempts: 0, lastError: null } });
    }

    const fields = {
      provider: 'google',
      externalAccountId: tokens.sub,
      accountEmail: tokens.email,
      refreshTokenEnc: this.box!.seal(tokens.refreshToken, tokenContext(tenantSlug, userId)),
      scopes: tokens.scopes,
      calendarId,
      calendarName,
      status: 'CONNECTED' as const,
      lastError: null,
      connectedAt: new Date(),
    };
    // The index first (two schemas, no shared transaction): if the connection write then fails,
    // a stale index row only delays a revoke, never revokes a grant still in use
    await this.prisma.calendarAccountIndex.upsert({
      where: { tenantSlug_userId: { tenantSlug, userId } },
      create: { externalAccountId: tokens.sub, tenantSlug, userId },
      update: { externalAccountId: tokens.sub },
    });
    const row: ConnectionRow = await connections.upsert({ where: { userId }, create: { userId, ...fields }, update: fields });
    this.accessTokens.set(this.tokenKey(tenantSlug, userId), { token: tokens.accessToken, expiresAt: tokens.expiresAt, calendarId, accountId: tokens.sub });

    this.events.emit<CalendarConnectionEvent>(SystemEvents.INTEGRATION_CALENDAR_CONNECTED, { tenantSlug, userId, timestamp: new Date() });
    await this.resync(tenantSlug, userId);
    // Locks that waited for this account to come back
    if (!switchedAccount && grantedFeatures.includes('meet')) {
      await this.meetSpaces.retryPending(tenantSlug, userId, tokens.accessToken, tokens.sub).catch((error: unknown) => {
        this.logger.warn(`Pending meeting locks of user ${userId} in ${tenantSlug} not retried: ${errorText(error)}`);
      });
    }
    return this.view(tenantSlug, row, switches);
  }

  async disconnect(tenantSlug: string, userId: string, opts: { deleteCalendar: boolean }): Promise<void> {
    const connections = this.connections(tenantSlug);
    const row: ConnectionRow | null = await connections.findUnique({ where: { userId } });
    if (!row || row.status === 'DISCONNECTED') return;

    const refreshToken = this.openToken(tenantSlug, row);
    const deleteCalendar = opts.deleteCalendar && !!row.calendarId;
    let accessToken: string | null = null;
    let tokenError: unknown = new Error('the stored Google access is missing');
    if (refreshToken && (deleteCalendar || granted(row.scopes, MEET_SCOPE))) {
      try {
        accessToken = await this.lastRefresh(refreshToken);
      } catch (error) {
        tokenError = error;
      }
    }
    if (deleteCalendar) {
      // Before anything changes, so a failure leaves the connection as it was
      try {
        if (!accessToken) throw tokenError;
        await this.google.deleteCalendar(accessToken, row.calendarId!);
      } catch (error) {
        throw this.httpError('Could not delete the calendar from your Google account; disconnect without deleting it, or delete it in Google Calendar', error);
      }
    }

    // Meetings the user hosts make guests knock from now on: locked before the grant is revoked
    await this.meetSpaces.lockHostSpaces(tenantSlug, userId, accessToken, 'The host disconnected Google');
    if (refreshToken) await this.revokeIfUnshared(tenantSlug, userId, row, refreshToken);
    // A calendar left in Google keeps its links: changes made while disconnected are recorded
    // on them, so reconnecting to the same calendar brings it up to date
    if (deleteCalendar || !row.calendarId) await this.links(tenantSlug).deleteMany({ where: { userId } });
    await this.prisma.calendarAccountIndex.deleteMany({ where: { tenantSlug, userId } });
    await connections.update({
      where: { userId },
      data: { status: 'DISCONNECTED', refreshTokenEnc: '', lastError: null, ...(deleteCalendar ? { calendarId: null, calendarName: null } : {}) },
    });
    this.forgetAccessToken(tenantSlug, userId);
  }

  /** The user was deleted or deactivated: take the tenant's calendar out of their Google account and forget them. */
  async offboard(tenantSlug: string, userId: string): Promise<void> {
    const row: ConnectionRow | null = await this.connections(tenantSlug).findUnique({ where: { userId } });
    const refreshToken = row ? this.openToken(tenantSlug, row) : null;
    // Not accessToken(): a dead grant must not tell a departing user to reconnect
    const accessToken = row && refreshToken ? await this.freshAccessToken(tenantSlug, row) : null;
    // First, while the token still works: the meetings they host stop admitting guests.
    // Whatever happens there, the departed user's token is forgotten below
    try {
      await this.meetSpaces.lockHostSpaces(tenantSlug, userId, accessToken, 'The host left the organization');
    } catch (error) {
      this.logger.warn(`Meetings of user ${userId} in ${tenantSlug} could not be locked: ${errorText(error)}`);
    }
    if (row && refreshToken) {
      if (row.calendarId && accessToken) {
        try {
          await this.google.deleteCalendar(accessToken, row.calendarId);
        } catch (error) {
          this.logger.warn(`Calendar of user ${userId} in ${tenantSlug} could not be removed from Google: ${errorText(error)}`);
        }
      }
      await this.revokeIfUnshared(tenantSlug, userId, row, refreshToken);
    }

    await this.links(tenantSlug).deleteMany({ where: { userId } });
    await this.prisma.calendarAccountIndex.deleteMany({ where: { tenantSlug, userId } });
    await this.connections(tenantSlug).deleteMany({ where: { userId } });
    this.forgetAccessToken(tenantSlug, userId);
  }

  /**
   * The tenant is about to be deleted: offboard everyone who connected while their
   * tokens still exist. One by one, so a shared Google account is revoked only by the last.
   */
  async offboardTenant(tenantSlug: string): Promise<void> {
    const rows: Array<{ userId: string }> = await this.connections(tenantSlug).findMany({ select: { userId: true } });
    for (const { userId } of rows) {
      try {
        await this.offboard(tenantSlug, userId);
      } catch (error) {
        this.logger.warn(`Google Calendar offboarding of user ${userId} in ${tenantSlug} failed: ${errorText(error)}`);
      }
    }
  }

  /** The tenant is gone: its users no longer share any Google account */
  async forgetTenant(tenantSlug: string): Promise<void> {
    await this.prisma.calendarAccountIndex.deleteMany({ where: { tenantSlug } });
  }

  /** The tenant's Google switches, read straight from the plugin config */
  async featureSwitches(tenantSlug: string): Promise<FeatureSwitches> {
    const plugin = await this.prisma.getTenantClient(tenantSlug).plugin.findUnique({ where: { key: PLUGIN_KEY } });
    const config = (plugin?.config ?? null) as {
      googleCalendar?: { enabled?: unknown };
      googleMeet?: { enabled?: unknown; defaultAccess?: unknown };
    } | null;
    const access = config?.googleMeet?.defaultAccess;
    return {
      calendar: config?.googleCalendar?.enabled === true,
      meet: config?.googleMeet?.enabled === true,
      meetDefaultAccess: ACCESS_TYPES.includes(access as MeetingAccess) ? (access as MeetingAccess) : 'TRUSTED',
    };
  }

  /** Google Calendar switched on for the tenant */
  async isEnabled(tenantSlug: string): Promise<boolean> {
    return (await this.featureSwitches(tenantSlug)).calendar;
  }

  async isMeetEnabled(tenantSlug: string): Promise<boolean> {
    return (await this.featureSwitches(tenantSlug)).meet;
  }

  async updateSettings(tenantSlug: string, patch: { calendarEnabled?: boolean; meetEnabled?: boolean; meetDefaultAccess?: MeetingAccess }): Promise<void> {
    const plugins = this.prisma.getTenantClient(tenantSlug).plugin;
    const plugin = await plugins.findUnique({ where: { key: PLUGIN_KEY } });
    const config = (plugin?.config as Record<string, any>) ?? {};
    const parsed = integrationConfigSchema.safeParse({
      ...config,
      ...(patch.calendarEnabled !== undefined ? { googleCalendar: { ...config.googleCalendar, enabled: patch.calendarEnabled } } : {}),
      ...(patch.meetEnabled !== undefined || patch.meetDefaultAccess !== undefined
        ? {
            googleMeet: {
              ...config.googleMeet,
              ...(patch.meetEnabled !== undefined ? { enabled: patch.meetEnabled } : {}),
              ...(patch.meetDefaultAccess !== undefined ? { defaultAccess: patch.meetDefaultAccess } : {}),
            },
          }
        : {}),
    });
    if (!parsed.success) throw new BadRequestException('The Integration settings are invalid; fix them before changing Google settings.');
    await plugins.update({ where: { key: PLUGIN_KEY }, data: { config: parsed.data } });
    if (patch.calendarEnabled) await this.resync(tenantSlug);
  }

  /** Per feature: switched off for the tenant, not usable until reconnected, granted (ready), or connected without the scope */
  async featureStates(
    tenantSlug: string,
    row: Pick<ConnectionRow, 'status' | 'scopes' | 'calendarId'> | null,
    switches?: FeatureSwitches,
  ): Promise<FeatureStates> {
    const on = switches ?? (await this.featureSwitches(tenantSlug));
    const scopes = row?.scopes ?? '';
    const state = (feature: GoogleFeature, allowed: boolean): FeatureState =>
      !on[feature] ? 'off' : row?.status !== 'CONNECTED' ? 'not-connected' : allowed ? 'ready' : 'needs-permission';
    return {
      calendar: state('calendar', granted(scopes, CALENDAR_SCOPE) && !!row?.calendarId),
      meet: state('meet', granted(scopes, MEET_SCOPE)),
    };
  }

  /** Open meetings the user hosts, whatever the tenant's Meet switch */
  activeMeetingCount(tenantSlug: string, userId: string): Promise<number> {
    return this.prisma.getTenantClient(tenantSlug).meetingSpace.count({ where: { hostUserId: userId, status: 'ACTIVE' } });
  }

  async listUsers(tenantSlug: string) {
    const client = this.prisma.getTenantClient(tenantSlug);
    const rows: ConnectionRow[] = await client.calendarConnection.findMany({ orderBy: { connectedAt: 'desc' } });
    const users = await client.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, username: true, name: true, email: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    const switches = await this.featureSwitches(tenantSlug);
    return Promise.all(
      rows.map(async (row) => {
        const user = byId.get(row.userId);
        return {
          userId: row.userId,
          name: user?.name || user?.username || null,
          email: user?.email ?? null,
          status: row.status,
          accountEmail: row.accountEmail,
          connectedAt: row.connectedAt,
          lastError: row.lastError,
          features: await this.featureStates(tenantSlug, row, switches),
        };
      }),
    );
  }

  /**
   * A usable access token for the user's calendar; throws calendarError(...) for the worker.
   * `calendarId` is the calendar the caller just read from the connection: a token cached for
   * another one (the user switched accounts through another API instance) is not used.
   */
  async accessToken(tenantSlug: string, userId: string, calendarId?: string | null): Promise<{ token: string; calendarId: string }> {
    const key = this.tokenKey(tenantSlug, userId);
    const cached = this.accessTokens.get(key);
    const sameCalendar = calendarId === undefined || cached?.calendarId === calendarId;
    if (cached?.calendarId && sameCalendar && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) return { token: cached.token, calendarId: cached.calendarId };

    const row: ConnectionRow | null = await this.connections(tenantSlug).findUnique({ where: { userId } });
    if (!row || row.status !== 'CONNECTED' || !row.calendarId) throw calendarError('CALENDAR_PERMANENT', 'Google Calendar is not connected');
    const token = await this.refreshFor(tenantSlug, row);
    return { token, calendarId: row.calendarId };
  }

  /**
   * A usable access token for a Google feature (e.g. Meet) of the user's connection; throws
   * calendarError(...). `accountId` is the Google account the caller expects (e.g. a meeting's
   * owner): a token cached for another account is not used. The result says which account it is.
   */
  async googleAccessToken(tenantSlug: string, userId: string, scope: string, accountId?: string): Promise<{ token: string; accountId: string }> {
    const cached = this.accessTokens.get(this.tokenKey(tenantSlug, userId));
    const sameAccount = accountId === undefined || cached?.accountId === accountId;
    const row: ConnectionRow | null = await this.connections(tenantSlug).findUnique({ where: { userId } });
    if (!row || row.status !== 'CONNECTED') throw calendarError('CALENDAR_PERMANENT', 'Google is not connected');
    if (!granted(row.scopes, scope)) throw calendarError('CALENDAR_PERMANENT', 'This Google permission was not granted');
    if (cached && sameAccount && cached.accountId === row.externalAccountId && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) {
      return { token: cached.token, accountId: cached.accountId };
    }
    return { token: await this.refreshFor(tenantSlug, row), accountId: row.externalAccountId };
  }

  /** Refreshes and caches the row's access token; Google failures become calendarError(...) */
  private async refreshFor(tenantSlug: string, row: ConnectionRow): Promise<string> {
    const { userId } = row;
    const key = this.tokenKey(tenantSlug, userId);
    const refreshToken = this.openToken(tenantSlug, row);
    if (!refreshToken) {
      await this.markNeedsReconnect(tenantSlug, userId, 'The stored Google access could not be read');
      throw calendarError('CALENDAR_PERMANENT', 'The stored Google access could not be read');
    }

    try {
      const { accessToken, expiresAt } = await this.google.refreshAccessToken(refreshToken);
      this.accessTokens.set(key, { token: accessToken, expiresAt, calendarId: row.calendarId, accountId: row.externalAccountId });
      return accessToken;
    } catch (error) {
      const code = error instanceof GoogleApiError ? error.code : null;
      // Only invalid_grant is about the user's grant; anything else from the token endpoint is the platform's
      if (code === 'INVALID_GRANT') {
        await this.markNeedsReconnect(tenantSlug, userId, 'Google access was revoked or has expired');
        throw calendarError('CALENDAR_PERMANENT', errorText(error));
      }
      // Anything else (e.g. the platform's client secret was rotated) isn't the user's to fix
      throw calendarError(code === 'RETRYABLE' ? 'CALENDAR_RETRYABLE' : 'CALENDAR_PERMANENT', errorText(error));
    }
  }

  forgetAccessToken(tenantSlug: string, userId: string): void {
    this.accessTokens.delete(this.tokenKey(tenantSlug, userId));
  }

  /**
   * Only the CONNECTED → NEEDS_RECONNECT transition notifies, so the user hears about it once;
   * the notification names the features that were working.
   */
  async markNeedsReconnect(tenantSlug: string, userId: string, reason: string): Promise<void> {
    this.forgetAccessToken(tenantSlug, userId);
    const before: ConnectionRow | null = await this.connections(tenantSlug).findUnique({ where: { userId } });
    const { count } = await this.connections(tenantSlug).updateMany({
      where: { userId, status: 'CONNECTED' },
      data: { status: 'NEEDS_RECONNECT', lastError: reason },
    });
    if (count > 0) {
      const states = await this.featureStates(tenantSlug, before);
      const features = (['calendar', 'meet'] as const).filter((feature) => states[feature] === 'ready').map((feature) => CORE_FEATURES[feature]);
      this.events.emit<CalendarConnectionEvent>(SystemEvents.INTEGRATION_CALENDAR_DISCONNECTED, { tenantSlug, userId, reason, features, timestamp: new Date() });
    }
  }

  private connections(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug).calendarConnection;
  }

  private links(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug).calendarEventLink;
  }

  private tokenKey(tenantSlug: string, userId: string): string {
    return `${tenantSlug}:${userId}`;
  }

  private assertConfigured(): void {
    if (!this.config.configured) throw new BadRequestException("Google isn't set up on this platform yet.");
  }

  private openToken(tenantSlug: string, row: ConnectionRow): string | null {
    if (!this.box || !row.refreshTokenEnc) return null;
    try {
      return this.box.open(row.refreshTokenEnc, tokenContext(tenantSlug, row.userId));
    } catch {
      return null; // sealed with another key, or for another row
    }
  }

  /** A fresh access token from the row's stored grant, or null (no grant, dead grant, Google down): never marks the row */
  private async freshAccessToken(tenantSlug: string, row: ConnectionRow): Promise<string | null> {
    const refreshToken = this.openToken(tenantSlug, row);
    if (!refreshToken) return null;
    try {
      return await this.lastRefresh(refreshToken);
    } catch (error) {
      this.logger.warn(`Google access of user ${row.userId} in ${tenantSlug} could not be refreshed: ${errorText(error)}`);
      return null;
    }
  }

  /** An access token for a grant about to go away: a busy Google is retried briefly, a dead grant isn't */
  private async lastRefresh(refreshToken: string): Promise<string> {
    const started = this.now();
    for (let attempt = 1; ; attempt++) {
      try {
        return (await this.google.refreshAccessToken(refreshToken)).accessToken;
      } catch (error) {
        const delay = LAST_REFRESH_DELAYS_MS[attempt];
        const busy = error instanceof GoogleApiError && error.code === 'RETRYABLE';
        if (!busy || delay === undefined || this.now() - started >= LAST_REFRESH_BUDGET_MS) throw error;
        await this.sleep(delay);
      }
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected now(): number {
    return Date.now();
  }

  /** The Google features the tenant has on, in a fixed order */
  private requestedFeatures(switches: FeatureSwitches): GoogleFeature[] {
    return (['calendar', 'meet'] as const).filter((feature) => switches[feature]);
  }

  private async view(tenantSlug: string, row: ConnectionRow, switches?: FeatureSwitches): Promise<ConnectionView> {
    return {
      status: row.status,
      accountEmail: row.accountEmail,
      calendarName: row.calendarName,
      connectedAt: row.connectedAt,
      lastError: row.lastError,
      syncedEvents: await this.links(tenantSlug).count({ where: { userId: row.userId, status: 'SYNCED' } }),
      features: await this.featureStates(tenantSlug, row, switches),
      activeMeetings: await this.activeMeetingCount(tenantSlug, row.userId),
    };
  }

  /**
   * Revoking at Google ends every grant this account gave the platform, including other
   * connections' (other tenants too): revoke only when no other connection uses it.
   */
  private async revokeIfUnshared(tenantSlug: string, userId: string, row: ConnectionRow, refreshToken = this.openToken(tenantSlug, row)): Promise<void> {
    if (!refreshToken) return;
    const others = await this.prisma.calendarAccountIndex.count({
      where: { externalAccountId: row.externalAccountId, NOT: { tenantSlug, userId } },
    });
    if (others > 0) return;
    try {
      await this.google.revoke(refreshToken);
    } catch (error) {
      this.logger.warn(`Could not revoke Google access of user ${userId} in ${tenantSlug}: ${errorText(error)}`);
    }
  }

  private async resync(tenantSlug: string, userId?: string): Promise<void> {
    try {
      await this.calendarSync.resync(tenantSlug, userId);
    } catch (error) {
      this.logger.warn(`Calendar resync for ${tenantSlug} failed; the replay sweep will retry: ${errorText(error)}`);
    }
  }

  private async tenantName(tenantSlug: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    return tenant?.name || tenantSlug;
  }

  private async tenantTimeZone(tenantSlug: string): Promise<string> {
    const config = await this.prisma.getTenantClient(tenantSlug).tenantConfig.findFirst();
    const zone = config?.timezone;
    return isValidTimeZone(zone) ? zone : 'UTC';
  }

  /** Google failures during a user's own action: retryable ones say "try again" */
  private httpError(prefix: string, error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof GoogleApiError && error.code === 'RETRYABLE') {
      return new ServiceUnavailableException(`${prefix}: Google is not reachable right now. Try again in a moment.`);
    }
    this.logger.warn(`${prefix}: ${errorText(error)}`);
    return new BadRequestException(`${prefix}. ${error instanceof GoogleApiError ? error.message : 'Try again.'}`);
  }
}
