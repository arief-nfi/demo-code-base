/**
 * Meetings contract.
 *
 * Core (apps/api) provides MEETINGS globally; a plugin gets a video meeting link for one
 * of its items with `@Inject(MEETINGS) meetings: IMeetingService` and never imports core
 * or the provider. The provider (Google Meet, in the Integration plugin) implements
 * IMeetingProvider and is provided as MEETING_PROVIDER.
 */

/** Who joins without knocking: TRUSTED = the host's organisation and invitees; OPEN = anyone with the link; RESTRICTED = invitees only */
export type MeetingAccess = 'TRUSTED' | 'OPEN' | 'RESTRICTED';
export const MEETING_ACCESS_TYPES: readonly MeetingAccess[] = ['TRUSTED', 'OPEN', 'RESTRICTED'];

export type MeetingStatus = 'ACTIVE' | 'CANCELLED' | 'ORPHANED';

/** One item's meeting: `create` is idempotent on (tenant, source, key) */
export interface MeetingRef {
  tenantSlug: string;
  /** The calling plugin's key (or 'core'): lowercase letters, digits and '-' */
  source: string;
  /** The caller's id for this meeting, 1–200 characters */
  key: string;
}

export interface MeetingCreateInput extends MeetingRef {
  /** Whose connected account hosts the meeting */
  hostUserId: string;
  /** Shown in the admin meetings list only, up to 200 characters */
  title?: string;
  /** Default: the tenant's default joining rule */
  access?: MeetingAccess;
}

export interface MeetingInfo {
  provider: string;
  joinUrl: string;
  hostUserId: string;
  access: MeetingAccess;
  status: MeetingStatus;
}

export type MeetingResult =
  | { status: 'created' | 'existing'; meeting: MeetingInfo }
  | { status: 'not-connected' | 'needs-permission' | 'disabled' | 'not-configured' }
  | { status: 'unavailable' | 'failed'; message: string };

export interface MeetingCancelResult {
  status: 'cancelled' | 'not-found';
  /** Whether the meeting is closed at the provider (guests must knock) */
  locked: boolean;
}

export interface IMeetingService {
  create(input: MeetingCreateInput): Promise<MeetingResult>;
  /** The item's current meeting from the app's own record (no provider call) */
  get(ref: MeetingRef): Promise<MeetingInfo | null>;
  cancel(ref: MeetingRef): Promise<MeetingCancelResult>;
}

/** Implemented by the plugin that talks to the meeting service (Integration → Google Meet). */
export interface IMeetingProvider {
  /** Creating meetings needs this plugin to be enabled (and paid for) for the tenant */
  readonly pluginKey: string;
  readonly name: string;
  /** False when the platform has no credentials for the meeting service */
  isConfigured(): boolean;
  /** The tenant's own on/off switch for meetings */
  isEnabledFor(tenantSlug: string): Promise<boolean>;
  create(input: MeetingCreateInput): Promise<MeetingResult>;
  /** Also called without credentials (isConfigured() false), so meetings stay visible */
  get(ref: MeetingRef): Promise<MeetingInfo | null>;
  /** Also called without credentials: the cancel is recorded and the lock waits until it can be applied */
  cancel(ref: MeetingRef): Promise<MeetingCancelResult>;
  /** Retries locks that couldn't be applied yet; returns how many got locked */
  retryPendingLocks(tenantSlug: string): Promise<number>;
}

export const MEETINGS = Symbol('MEETINGS');
export const MEETING_PROVIDER = Symbol('MEETING_PROVIDER');
