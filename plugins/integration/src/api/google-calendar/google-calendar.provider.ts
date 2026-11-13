import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@saas/database';
import {
  CacheService,
  calendarError,
  PluginAccess,
  PrismaService,
  type CalendarConnectionSummary,
  type CalendarRef,
  type CalendarRequest,
  type ICalendarProvider,
  type NormalizedCalendarEvent,
} from '@saas/backend';
import { CALENDAR_SCOPE, GOOGLE_API, GoogleApiError, MEET_LINK, type GoogleApi, type GoogleEventBody } from './google-api';
import { GOOGLE_CALENDAR_CONFIG, type GoogleCalendarConfig } from './google-calendar.config';
import { googleEventId } from './google-event-id';
import { ConnectionsService, CORE_FEATURES } from './connections.service';

const PENDING_BATCH = 1000;

/** The Google connection also serves Meet: only one that granted Calendar and has its calendar syncs events */
const usesCalendar = (connection: { scopes: string; calendarId: string | null }) =>
  !!connection.calendarId && connection.scopes.split(' ').includes(CALENDAR_SCOPE);

/**
 * The event's requested state changed while it was being applied. BullMQ ignored the newer
 * job (this one was running), so retrying this one, which reads the row again, applies it.
 */
const changedMeanwhile = () => calendarError('CALENDAR_RETRYABLE', 'The event changed while it was being synced; syncing the newer version');

/**
 * Google Calendar behind core's calendar contract. Each event's requested state lives
 * in its CalendarEventLink row; apply() pushes the row's current state to Google, so a
 * late or repeated job does no harm.
 */
@Injectable()
export class GoogleCalendarProvider implements ICalendarProvider {
  readonly pluginKey = 'integration';
  readonly name = 'google';
  private readonly logger = new Logger(GoogleCalendarProvider.name);
  private readonly access: PluginAccess;

  constructor(
    private readonly prisma: PrismaService,
    cache: CacheService,
    @Inject(GOOGLE_API) private readonly google: GoogleApi,
    @Inject(GOOGLE_CALENDAR_CONFIG) private readonly config: GoogleCalendarConfig,
    private readonly connections: ConnectionsService,
  ) {
    this.access = new PluginAccess(prisma, cache);
  }

  isConfigured(): boolean {
    return this.config.configured;
  }

  isEnabledFor(tenantSlug: string): Promise<boolean> {
    return this.connections.isEnabled(tenantSlug);
  }

  async record(request: CalendarRequest): Promise<'connected' | 'paused-reconnect' | 'none'> {
    const { tenantSlug, userId, source, key } = request;
    const client = this.prisma.getTenantClient(tenantSlug);
    const connection = await client.calendarConnection.findUnique({ where: { userId } });
    if (!connection) return 'none';

    const desired = request.op === 'upsert' && request.event ? (request.event as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    const state = { desired, status: 'PENDING' as const, attempts: 0, lastError: null };
    if (connection.status === 'DISCONNECTED') {
      // Only events already in the calendar left in Google are kept up to date, for a reconnect
      const { count } = await client.calendarEventLink.updateMany({ where: { userId, source, key }, data: state });
      return count > 0 ? 'paused-reconnect' : 'none';
    }
    if (!usesCalendar(connection)) return 'none'; // e.g. connected for Meet only
    await client.calendarEventLink.upsert({
      where: { userId_source_key: { userId, source, key } },
      create: { userId, source, key, externalEventId: googleEventId(tenantSlug, userId, source, key), ...state },
      update: state,
    });
    return connection.status === 'CONNECTED' ? 'connected' : 'paused-reconnect';
  }

  async apply(ref: CalendarRef): Promise<void> {
    const { tenantSlug, userId, source, key } = ref;
    const client = this.prisma.getTenantClient(tenantSlug);
    const links = client.calendarEventLink;
    const row = await links.findUnique({ where: { userId_source_key: { userId, source, key } } });
    if (!row || row.status !== 'PENDING') return; // already applied, or failed until someone retries it

    // Can't sync right now: the row stays PENDING and is replayed once syncing resumes
    const connection = await client.calendarConnection.findUnique({ where: { userId } });
    if (connection?.status !== 'CONNECTED' || !usesCalendar(connection)) return;
    if (!(await this.access.check(this.pluginKey, tenantSlug)).ok || !(await this.connections.isEnabled(tenantSlug))) return;

    const event = row.desired as unknown as NormalizedCalendarEvent | null;
    // Written only if nobody recorded a newer request while Google was being called
    const unchanged = { id: row.id, updatedAt: row.updatedAt };
    // The token and calendar of the last call, for checking what a "not found" meant
    const used: { current: { token: string; calendarId: string } | null } = { current: null };
    try {
      await this.withToken(tenantSlug, userId, connection.calendarId, (token, calendarId) => {
        used.current = { token, calendarId };
        return event ? this.putEvent(token, calendarId, row.externalEventId, ref, event) : this.google.deleteEvent(token, calendarId, row.externalEventId);
      });
    } catch (error) {
      throw await this.failure(ref, row.id, unchanged, error, used.current);
    }

    const { count } = event
      ? await links.updateMany({ where: unchanged, data: { status: 'SYNCED', syncedAt: new Date(), attempts: { increment: 1 }, lastError: null } })
      : await links.deleteMany({ where: unchanged });
    if (count === 0) throw changedMeanwhile();
  }

  async pendingRefs(tenantSlug: string, userId?: string): Promise<CalendarRef[]> {
    const client = this.prisma.getTenantClient(tenantSlug);
    const connected = await client.calendarConnection.findMany({
      where: { status: 'CONNECTED', calendarId: { not: null }, ...(userId ? { userId } : {}) },
      select: { userId: true },
    });
    if (connected.length === 0) return [];
    const rows = await client.calendarEventLink.findMany({
      where: { status: 'PENDING', userId: { in: connected.map((c) => c.userId) } },
      select: { userId: true, source: true, key: true },
      orderBy: { updatedAt: 'asc' },
      take: PENDING_BATCH,
    });
    return rows.map((row) => ({ tenantSlug, userId: row.userId, source: row.source, key: row.key }));
  }

  async connectionOf(tenantSlug: string, userId: string): Promise<CalendarConnectionSummary | null> {
    const row = await this.prisma.getTenantClient(tenantSlug).calendarConnection.findUnique({ where: { userId } });
    if (!row || row.status === 'DISCONNECTED') return null;
    const states = await this.connections.featureStates(tenantSlug, row);
    const features = (['calendar', 'meet'] as const)
      .filter((feature) => states[feature] !== 'off')
      .map((feature) => ({ key: CORE_FEATURES[feature], name: feature === 'calendar' ? 'Calendar' : 'Meet', ready: states[feature] === 'ready' }));
    return {
      provider: 'Google',
      status: row.status,
      accountEmail: row.accountEmail,
      calendarName: row.calendarName,
      lastError: row.lastError,
      manageAccessUrl: 'https://myaccount.google.com/connections',
      features,
      activeMeetings: await this.connections.activeMeetingCount(tenantSlug, userId),
    };
  }

  disconnect(tenantSlug: string, userId: string, opts: { deleteCalendar: boolean }): Promise<void> {
    return this.connections.disconnect(tenantSlug, userId, opts);
  }

  /** A cached access token can be revoked before it expires: on a 401, retry once with a fresh one */
  private async withToken(
    tenantSlug: string,
    userId: string,
    calendarId: string | null,
    call: (token: string, calendarId: string) => Promise<void>,
  ): Promise<void> {
    const first = await this.connections.accessToken(tenantSlug, userId, calendarId);
    try {
      await call(first.token, first.calendarId);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.code !== 'UNAUTHORIZED') throw error;
      this.connections.forgetAccessToken(tenantSlug, userId);
      const fresh = await this.connections.accessToken(tenantSlug, userId, calendarId);
      await call(fresh.token, fresh.calendarId);
    }
  }

  /**
   * Saves the event. Should Google refuse its Meet link as the event's conferencing, it
   * saves the event again with the link where any other meeting link goes.
   */
  private async putEvent(token: string, calendarId: string, eventId: string, ref: CalendarRef, event: NormalizedCalendarEvent): Promise<void> {
    const body = this.body(ref, event, true);
    try {
      await this.google.putEvent(token, calendarId, eventId, body);
    } catch (error) {
      if (!body.conferenceData || !(error instanceof GoogleApiError) || error.code !== 'REJECTED') throw error;
      this.logger.warn(`Google refused the Meet link as the event's conferencing (${error.message}): saving it as a plain link`);
      await this.google.putEvent(token, calendarId, eventId, this.body(ref, event, false));
    }
  }

  private body(ref: CalendarRef, event: NormalizedCalendarEvent, conferencing: boolean): GoogleEventBody {
    const app = this.config.appName;
    const meet = conferencing && event.meetingUrl && MEET_LINK.test(event.meetingUrl) ? event.meetingUrl : undefined;
    // Any other meeting link is the location, unless the caller gave one
    const plainMeeting = event.meetingUrl && !meet ? event.meetingUrl : undefined;
    const location = event.location ?? plainMeeting;
    const description = [
      event.description,
      plainMeeting && event.location && `Join the meeting: ${plainMeeting}`,
      event.url && `Open in ${app}: ${event.url}`,
      `Managed by ${app} — changes made here may be overwritten.`,
    ].filter(Boolean);
    return {
      summary: event.title,
      description: description.join('\n\n'),
      ...(location ? { location } : {}),
      ...(meet
        ? {
            conferenceData: {
              conferenceSolution: { key: { type: 'hangoutsMeet' } },
              entryPoints: [{ entryPointType: 'video', uri: meet, label: meet.replace(/^https:\/\//, '') }],
            },
          }
        : {}),
      start: event.allDay ? { date: event.start } : { dateTime: event.start, timeZone: event.timeZone },
      end: event.allDay ? { date: event.end } : { dateTime: event.end, timeZone: event.timeZone },
      extendedProperties: { private: { source: ref.source, key: ref.key } },
      ...(event.url ? { source: { title: app, url: event.url } } : {}),
    };
  }

  /** Records what went wrong and returns the error for the worker: retry, or give up */
  private async failure(
    ref: CalendarRef,
    id: string,
    unchanged: { id: string; updatedAt: Date },
    error: unknown,
    used: { token: string; calendarId: string } | null,
  ): Promise<Error> {
    const { tenantSlug, userId } = ref;
    const links = this.prisma.getTenantClient(tenantSlug).calendarEventLink;
    if (!(error instanceof GoogleApiError)) return error as Error; // accessToken's calendarError, or a bug: as is

    const retry = async () => {
      await links.updateMany({ where: { id }, data: { attempts: { increment: 1 }, lastError: error.message } });
      return calendarError('CALENDAR_RETRYABLE', error.message);
    };
    const failEvent = async () => {
      const { count } = await links.updateMany({ where: unchanged, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: error.message } });
      // A newer request arrived meanwhile: try that one instead of failing
      return count === 0 ? changedMeanwhile() : calendarError('CALENDAR_PERMANENT', error.message);
    };
    const reconnect = async (reason: string) => {
      await this.connections.markNeedsReconnect(tenantSlug, userId, reason);
      return calendarError('CALENDAR_PERMANENT', error.message);
    };

    switch (error.code) {
      case 'RETRYABLE':
        return retry();
      case 'INVALID_GRANT':
      case 'UNAUTHORIZED':
        return reconnect('Google access was revoked or has expired');
      case 'NOT_FOUND': {
        // Only a missing calendar breaks the connection; otherwise just this event is unreachable
        let calendarExists: boolean;
        try {
          calendarExists = used ? await this.google.calendarExists(used.token, used.calendarId) : false;
        } catch {
          return retry();
        }
        return calendarExists ? failEvent() : reconnect('The calendar was deleted in Google');
      }
      default:
        return failEvent();
    }
  }
}
