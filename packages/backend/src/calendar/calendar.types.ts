/**
 * Calendar sync contract.
 *
 * Core (apps/api) provides CALENDAR_SYNC globally; a plugin puts an item on a user's
 * calendar with `@Inject(CALENDAR_SYNC) calendar: ICalendarSync` and never imports core
 * or the provider. The provider (Google, in the Integration plugin) implements
 * ICalendarProvider and is provided as CALENDAR_PROVIDER.
 */

export type CalendarSyncStatus = 'queued' | 'not-connected' | 'disabled' | 'not-configured';

export interface CalendarEventInput {
  title: string;
  /** ISO string or Date; an all-day event may also pass a `YYYY-MM-DD` date */
  start: string | Date;
  /** Default: start + 30 minutes (all-day: start + 1 day). An all-day end is exclusive: the day after the last day */
  end?: string | Date;
  allDay?: boolean;
  /** IANA zone name; default the tenant's TenantConfig.timezone */
  timeZone?: string;
  description?: string;
  location?: string;
  /** http(s) link back to the item in the app */
  url?: string;
  /**
   * The event's video meeting (an https join link, e.g. from MEETINGS.create). Providers
   * show it as the event's conferencing where they can (Google: a Meet link becomes the
   * event's Google Meet), otherwise as its location.
   */
  meetingUrl?: string;
}

/** One event on one user's calendar: upserts are idempotent on (tenant, user, source, key) */
export interface CalendarRef {
  tenantSlug: string;
  userId: string;
  /** The calling plugin's key (or 'core'): lowercase letters, digits and '-' */
  source: string;
  /** The caller's id for this event, 1–200 characters */
  key: string;
}

export interface NormalizedCalendarEvent {
  title: string;
  /** ISO instant; for an all-day event a `YYYY-MM-DD` date */
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string;
  description?: string;
  location?: string;
  url?: string;
  meetingUrl?: string;
}

/** The requested state of one event, which the provider stores until it is applied */
export interface CalendarRequest extends CalendarRef {
  op: 'upsert' | 'remove';
  /** Set for upserts */
  event?: NormalizedCalendarEvent;
}

export interface ICalendarSync {
  upsert(input: CalendarRef & CalendarEventInput): Promise<{ status: CalendarSyncStatus }>;
  remove(ref: CalendarRef): Promise<{ status: CalendarSyncStatus }>;
  /** Queues the stored requests that can sync now (all users, or one); returns how many */
  resync(tenantSlug: string, userId?: string): Promise<number>;
}

/** A user's own calendar connection, as their account page shows it: never a token */
export interface CalendarConnectionSummary {
  /** What it connects to, e.g. 'Google Calendar' */
  provider: string;
  status: 'CONNECTED' | 'NEEDS_RECONNECT';
  accountEmail: string;
  calendarName: string | null;
  lastError: string | null;
  /** Where the user can also remove the app's access at the provider */
  manageAccessUrl?: string;
  /**
   * What the connection is used for (features the tenant has on) and whether each is allowed;
   * `key` ('calendar', 'meetings') lets the app show its own words, `name` is the provider's
   */
  features?: Array<{ key: 'calendar' | 'meetings'; name: string; ready: boolean }>;
  /** Open meetings the user hosts: disconnecting locks them */
  activeMeetings?: number;
}

/** Implemented by the plugin that talks to the calendar service (Integration → Google). */
export interface ICalendarProvider {
  /** Syncing needs this plugin to be enabled (and paid for) for the tenant */
  readonly pluginKey: string;
  readonly name: string;
  /** False when the platform has no credentials for the calendar service */
  isConfigured(): boolean;
  /** The tenant's own on/off switch for calendar sync */
  isEnabledFor(tenantSlug: string): Promise<boolean>;
  /** Stores the request (unless the user has no connection) and returns the user's connection state */
  record(request: CalendarRequest): Promise<'connected' | 'paused-reconnect' | 'none'>;
  /**
   * Applies the event's current requested state; a no-op when it can't sync right now.
   * Throws calendarError('CALENDAR_RETRYABLE' | 'CALENDAR_PERMANENT', ...) on failure.
   */
  apply(ref: CalendarRef): Promise<void>;
  /** Stored requests not yet applied, for users who can sync */
  pendingRefs(tenantSlug: string, userId?: string): Promise<CalendarRef[]>;
  /**
   * The user's own connection (null when there is none) and leaving it. Core serves these
   * outside the plugin's guard, so people can disconnect even while the plugin is unusable.
   */
  connectionOf(tenantSlug: string, userId: string): Promise<CalendarConnectionSummary | null>;
  disconnect(tenantSlug: string, userId: string, opts: { deleteCalendar: boolean }): Promise<void>;
}

export const CALENDAR_SYNC = Symbol('CALENDAR_SYNC');
export const CALENDAR_PROVIDER = Symbol('CALENDAR_PROVIDER');

export type CalendarErrorCode = 'CALENDAR_RETRYABLE' | 'CALENDAR_PERMANENT';

/**
 * The errors a provider throws from apply(). They are matched by `code` rather than
 * `instanceof`, since @saas/backend may be loaded twice (src vs dist).
 */
export function calendarError(code: CalendarErrorCode, message: string): Error & { code: CalendarErrorCode } {
  return Object.assign(new Error(message), { code });
}

export function isCalendarError(error: unknown, code: CalendarErrorCode): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}
