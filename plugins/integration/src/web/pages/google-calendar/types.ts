import { ApiRequestError } from '@saas/ui';

export const GOOGLE_CALENDAR_API = '/plugins/integration/google-calendar';
export const GOOGLE_CALENDAR_PAGE = '/plugins/integration/google-calendar';
export const CONNECT_PERMISSION = 'integration.google-calendar.connect';
export const MANAGE_PERMISSION = 'integration.google-calendar.manage';

export type ConnectionStatus = 'CONNECTED' | 'NEEDS_RECONNECT' | 'DISCONNECTED';
export type LinkStatus = 'PENDING' | 'SYNCED' | 'FAILED';
export type MeetingAccess = 'TRUSTED' | 'OPEN' | 'RESTRICTED';
export type MeetingStatus = 'ACTIVE' | 'CANCELLED' | 'ORPHANED';
export type MeetingLockState = 'OPEN' | 'LOCKED' | 'PENDING' | 'FAILED';
/** off: switched off for the organization; needs-permission: connected but not allowed in Google; not-connected: needs reconnecting or disconnected */
export type FeatureState = 'ready' | 'needs-permission' | 'off' | 'not-connected';
export type GoogleFeature = 'calendar' | 'meet';

export const MEETING_ACCESS: readonly MeetingAccess[] = ['TRUSTED', 'OPEN', 'RESTRICTED'];

export interface ConnectionView {
  status: ConnectionStatus;
  accountEmail: string;
  calendarName: string | null;
  connectedAt: string;
  lastError: string | null;
  syncedEvents: number;
  features: Record<GoogleFeature, FeatureState>;
  /** Open meetings the user hosts: disconnecting locks them */
  activeMeetings: number;
}

export interface GoogleSettings {
  configured: boolean;
  calendar: { enabled: boolean };
  meet: { enabled: boolean; defaultAccess: MeetingAccess };
}

export interface MyGoogleStatus extends GoogleSettings {
  connection: ConnectionView | null;
}

export interface CalendarUserRow {
  userId: string;
  name: string | null;
  email: string | null;
  status: ConnectionStatus;
  accountEmail: string;
  connectedAt: string;
  lastError: string | null;
  features: Record<GoogleFeature, FeatureState>;
}

export interface SyncLogRow {
  id: string;
  userId: string;
  user: { name: string | null; email: string } | null;
  source: string;
  key: string;
  title: string | null;
  start: string | null;
  status: LinkStatus;
  attempts: number;
  lastError: string | null;
  syncedAt: string | null;
  updatedAt: string;
}

export interface Page<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export type SyncLogPage = Page<SyncLogRow>;

export interface MeetingRow {
  id: string;
  title: string | null;
  source: string | null;
  key: string | null;
  host: { name: string | null; email: string } | null;
  joinUrl: string;
  access: MeetingAccess;
  status: MeetingStatus;
  lockState: MeetingLockState;
  lastError: string | null;
  /** The item's current meeting: only that one can be cancelled */
  current: boolean;
  createdAt: string;
}

export const STATUS_VARIANT: Record<ConnectionStatus | LinkStatus | MeetingStatus, 'success' | 'warning' | 'destructive' | 'outline'> = {
  CONNECTED: 'success',
  NEEDS_RECONNECT: 'warning',
  DISCONNECTED: 'outline',
  PENDING: 'outline',
  SYNCED: 'success',
  FAILED: 'destructive',
  ACTIVE: 'success',
  CANCELLED: 'outline',
  ORPHANED: 'warning',
};

export const errorMessage = (error: unknown, fallback: string) => (error instanceof ApiRequestError && error.message ? error.message : fallback);
