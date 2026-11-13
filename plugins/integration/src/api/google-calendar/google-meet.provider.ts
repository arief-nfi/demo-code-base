import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  isCalendarError,
  PluginEventService,
  PrismaService,
  SystemEvents,
  type IMeetingProvider,
  type MeetingAccess,
  type MeetingCancelResult,
  type MeetingCreateInput,
  type MeetingEvent,
  type MeetingInfo,
  type MeetingRef,
  type MeetingResult,
} from '@saas/backend';
import { ConnectionsService } from './connections.service';
import { GOOGLE_API, GoogleApiError, MEET_SCOPE, type GoogleApi } from './google-api';
import { GOOGLE_CALENDAR_CONFIG, type GoogleCalendarConfig } from './google-calendar.config';
import { MeetSpacesService } from './meet-spaces.service';

/** A creation claim older than this was abandoned (a crash): another request may take over */
const CLAIM_STALE_MS = 60_000;
/** A second request for an item being created waits up to POLLS × POLL_MS for the first one */
const CLAIM_POLL_MS = 250;
const CLAIM_POLLS = 12;
/** A cancel waits for a create in progress at most until its claim would count as abandoned */
const CANCEL_CLAIM_POLLS = CLAIM_STALE_MS / CLAIM_POLL_MS;
const RETRY_DELAY_MS = 500;
const BEING_CREATED = 'This meeting is being created; try again.';
const PLATFORM_REFUSED = "Google didn't accept this platform's sign-in. Tell your platform administrator.";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface SpaceRow {
  id: string;
  hostUserId: string;
  hostAccountId: string;
  spaceName: string;
  joinUrl: string;
  access: MeetingAccess;
  status: 'ACTIVE' | 'CANCELLED' | 'ORPHANED';
  lockState: 'OPEN' | 'LOCKED' | 'PENDING' | 'FAILED';
}

const info = (space: SpaceRow): MeetingInfo => ({
  provider: 'google-meet', joinUrl: space.joinUrl, hostUserId: space.hostUserId, access: space.access, status: space.status,
});

/**
 * Google Meet behind core's meetings contract. Each item (source + key) has one current
 * Meet space, created in the host's Google account; concurrent requests for an item make
 * one space (a short-lived claim on the item). Spaces the app stops using are locked.
 */
@Injectable()
export class GoogleMeetProvider implements IMeetingProvider {
  readonly pluginKey = 'integration';
  readonly name = 'google';
  private readonly logger = new Logger(GoogleMeetProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GOOGLE_API) private readonly google: GoogleApi,
    @Inject(GOOGLE_CALENDAR_CONFIG) private readonly config: GoogleCalendarConfig,
    private readonly connections: ConnectionsService,
    private readonly spaces: MeetSpacesService,
    private readonly events: PluginEventService,
  ) {}

  isConfigured(): boolean {
    return this.config.configured;
  }

  isEnabledFor(tenantSlug: string): Promise<boolean> {
    return this.connections.isMeetEnabled(tenantSlug);
  }

  async create(input: MeetingCreateInput): Promise<MeetingResult> {
    const { tenantSlug, hostUserId, source, key } = input;
    const client = this.prisma.getTenantClient(tenantSlug);
    const connection = await client.calendarConnection.findUnique({ where: { userId: hostUserId } });
    if (!connection || connection.status !== 'CONNECTED') return { status: 'not-connected' };
    if (!connection.scopes.split(' ').includes(MEET_SCOPE)) return { status: 'needs-permission' };

    const title = input.title?.trim() || null;
    const item = await client.meetingItem
      .upsert({ where: { source_key: { source, key } }, create: { source, key, title }, update: title ? { title } : {} })
      .catch(async (error: unknown) => {
        // Two first requests at once: the other one created the item
        if ((error as { code?: string }).code !== 'P2002') throw error;
        return client.meetingItem.findUniqueOrThrow({ where: { source_key: { source, key } } });
      });

    if (!(await this.claim(tenantSlug, item.id))) return this.waitForOther(tenantSlug, item.id);
    try {
      return await this.createClaimed(input, item.id);
    } catch (error) {
      return this.failureResult(tenantSlug, hostUserId, error);
    } finally {
      await client.meetingItem.updateMany({ where: { id: item.id }, data: { creatingSince: null } });
    }
  }

  async get(ref: MeetingRef): Promise<MeetingInfo | null> {
    const space = await this.currentSpace(ref);
    return space ? info(space) : null;
  }

  /** Works without Google credentials too: the lock then waits for the sweep */
  async cancel(ref: MeetingRef): Promise<MeetingCancelResult> {
    const client = this.prisma.getTenantClient(ref.tenantSlug);
    const item = await client.meetingItem.findUnique({ where: { source_key: { source: ref.source, key: ref.key } } });
    if (!item) return { status: 'not-found', locked: false };

    // A create in progress finishes first, so the meeting it makes is the one cancelled
    let claimed = false;
    for (let poll = 0; !(claimed = await this.claim(ref.tenantSlug, item.id)) && poll < CANCEL_CLAIM_POLLS; poll++) {
      await this.sleep(CLAIM_POLL_MS);
    }
    try {
      return await this.cancelCurrent(ref);
    } finally {
      if (claimed) await client.meetingItem.updateMany({ where: { id: item.id }, data: { creatingSince: null } });
    }
  }

  async retryPendingLocks(tenantSlug: string): Promise<number> {
    const client = this.prisma.getTenantClient(tenantSlug);
    const pending: SpaceRow[] = await client.meetingSpace.findMany({ where: { lockState: 'PENDING' } });
    let locked = 0;
    for (const userId of new Set(pending.map((space) => space.hostUserId))) {
      try {
        const connection = await client.calendarConnection.findUnique({ where: { userId } });
        if (!connection || connection.status === 'DISCONNECTED') {
          await this.spaces.failPending(tenantSlug, userId, 'The host is no longer connected to Google');
          continue;
        }
        // NEEDS_RECONNECT, or Meet not allowed: the host may still fix it
        if (connection.status !== 'CONNECTED' || !connection.scopes.split(' ').includes(MEET_SCOPE)) continue;
        const { token, accountId } = await this.connections.googleAccessToken(tenantSlug, userId, MEET_SCOPE);
        locked += await this.spaces.retryPending(tenantSlug, userId, token, accountId);
      } catch (error) {
        this.logger.warn(`Pending meeting locks of user ${userId} in ${tenantSlug} not retried: ${errorText(error)}`);
      }
    }
    return locked;
  }

  private async cancelCurrent(ref: MeetingRef): Promise<MeetingCancelResult> {
    const space = await this.currentSpace(ref);
    if (!space) return { status: 'not-found', locked: false };
    if (space.status === 'CANCELLED') return { status: 'cancelled', locked: space.lockState === 'LOCKED' };

    const spaces = this.prisma.getTenantClient(ref.tenantSlug).meetingSpace;
    if (space.status !== 'ACTIVE') {
      // An orphaned meeting was already locked (or recorded as failed) when it was orphaned
      await spaces.update({ where: { id: space.id }, data: { status: 'CANCELLED' } });
      this.emitCancelled(ref, space.hostUserId, 'Cancelled', false);
      return { status: 'cancelled', locked: space.lockState === 'LOCKED' };
    }
    // Recorded before Google is asked: if Google is slow, "cancelled, not locked yet" is already true
    // and the sweep finishes the lock
    await spaces.update({ where: { id: space.id }, data: { status: 'CANCELLED', lockState: 'PENDING' } });
    this.emitCancelled(ref, space.hostUserId, 'Cancelled', false);
    // Without credentials no token can be had (and asking would mark the host as needing to reconnect)
    const token = this.isConfigured() ? await this.tokenFor(ref.tenantSlug, space) : null;
    const lockState = await this.spaces.lock(ref.tenantSlug, token, space, 'retry-later');
    return { status: 'cancelled', locked: lockState === 'LOCKED' };
  }

  private async createClaimed(input: MeetingCreateInput, itemId: string): Promise<MeetingResult> {
    const { tenantSlug, hostUserId } = input;
    const client = this.prisma.getTenantClient(tenantSlug);
    const item = await client.meetingItem.findUnique({ where: { id: itemId } });
    const current: SpaceRow | null = item?.currentSpaceId ? await client.meetingSpace.findUnique({ where: { id: item.currentSpaceId } }) : null;

    if (current?.status === 'ACTIVE' && current.hostUserId === hostUserId) {
      const access = input.access;
      if (!access || access === current.access) return { status: 'existing', meeting: info(current) };
      await this.withHostToken(tenantSlug, hostUserId, current.hostAccountId, (token) => this.google.setSpaceAccess(token, current.spaceName, access));
      return { status: 'existing', meeting: info(await client.meetingSpace.update({ where: { id: current.id }, data: { access } })) };
    }

    const access = input.access ?? (await this.connections.featureSwitches(tenantSlug)).meetDefaultAccess;
    const { space, accountId } = await this.withHostToken(tenantSlug, hostUserId, undefined, async (token, accountId) => ({
      space: await this.google.createSpace(token, access),
      accountId,
    }));
    const row: SpaceRow = await client.meetingSpace.create({
      data: { itemId, hostUserId, hostAccountId: accountId, spaceName: space.name, joinUrl: space.meetingUri, access },
    });
    await client.meetingItem.update({ where: { id: itemId }, data: { currentSpaceId: row.id } });

    // The item moved to another host: close the previous meeting
    if (current?.status === 'ACTIVE') {
      await this.spaces.lock(tenantSlug, await this.tokenFor(tenantSlug, current), current, 'retry-later');
      await client.meetingSpace.update({ where: { id: current.id }, data: { status: 'CANCELLED' } });
      this.emitCancelled(input, current.hostUserId, 'The meeting moved to another host', true);
    }
    this.emit(SystemEvents.INTEGRATION_MEETING_CREATED, input, hostUserId);
    return { status: 'created', meeting: info(row) };
  }

  /** Takes the item's creation claim, or an abandoned one; false while another request holds it */
  private async claim(tenantSlug: string, itemId: string): Promise<boolean> {
    const { count } = await this.prisma.getTenantClient(tenantSlug).meetingItem.updateMany({
      where: { id: itemId, OR: [{ creatingSince: null }, { creatingSince: { lt: new Date(Date.now() - CLAIM_STALE_MS) } }] },
      data: { creatingSince: new Date() },
    });
    return count === 1;
  }

  /** Another request is creating this item's meeting: wait briefly and return what it made */
  private async waitForOther(tenantSlug: string, itemId: string): Promise<MeetingResult> {
    const client = this.prisma.getTenantClient(tenantSlug);
    for (let poll = 0; poll < CLAIM_POLLS; poll++) {
      await this.sleep(CLAIM_POLL_MS);
      const item = await client.meetingItem.findUnique({ where: { id: itemId } });
      if (item?.creatingSince) continue;
      const current: SpaceRow | null = item?.currentSpaceId ? await client.meetingSpace.findUnique({ where: { id: item.currentSpaceId } }) : null;
      if (current?.status === 'ACTIVE') return { status: 'existing', meeting: info(current) };
      break;
    }
    return { status: 'unavailable', message: BEING_CREATED };
  }

  /** Calls Google with the host's token: one retry when Google is busy, and one with a fresh token on a 401 */
  private async withHostToken<T>(tenantSlug: string, userId: string, accountId: string | undefined, call: (token: string, accountId: string) => Promise<T>): Promise<T> {
    const run = async () => {
      const access = await this.connections.googleAccessToken(tenantSlug, userId, MEET_SCOPE, accountId);
      return call(access.token, access.accountId);
    };
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof GoogleApiError)) throw error;
      if (error.code === 'RETRYABLE') {
        await this.sleep(RETRY_DELAY_MS);
        return run();
      }
      if (error.code === 'UNAUTHORIZED') {
        this.connections.forgetAccessToken(tenantSlug, userId);
        return run();
      }
      throw error;
    }
  }

  /** The token of the Google account that owns the space; null when it can't be had */
  private async tokenFor(tenantSlug: string, space: SpaceRow): Promise<string | null> {
    try {
      const { token, accountId } = await this.connections.googleAccessToken(tenantSlug, space.hostUserId, MEET_SCOPE, space.hostAccountId);
      return accountId === space.hostAccountId ? token : null;
    } catch {
      return null;
    }
  }

  private async failureResult(tenantSlug: string, userId: string, error: unknown): Promise<MeetingResult> {
    if (isCalendarError(error, 'CALENDAR_RETRYABLE')) return { status: 'unavailable', message: 'Google is busy; try again.' };
    if (isCalendarError(error, 'CALENDAR_PERMANENT')) {
      // No token: the user's (their grant died, the row was marked) or the platform's (e.g. a rotated client secret)
      const connection = await this.prisma.getTenantClient(tenantSlug).calendarConnection.findUnique({ where: { userId } });
      if (connection?.status !== 'CONNECTED') return { status: 'not-connected' };
      if (!connection.scopes.split(' ').includes(MEET_SCOPE)) return { status: 'needs-permission' };
      this.logger.warn(`Meeting for user ${userId} in ${tenantSlug} not created: ${errorText(error)}`);
      return { status: 'failed', message: PLATFORM_REFUSED };
    }
    if (!(error instanceof GoogleApiError)) throw error;
    switch (error.code) {
      case 'RETRYABLE':
        return { status: 'unavailable', message: 'Google is busy; try again.' };
      case 'INVALID_GRANT':
      case 'UNAUTHORIZED':
        await this.connections.markNeedsReconnect(tenantSlug, userId, 'Google access was revoked or has expired');
        return { status: 'not-connected' };
      default:
        return { status: 'failed', message: error.message };
    }
  }

  private async currentSpace(ref: MeetingRef): Promise<SpaceRow | null> {
    const client = this.prisma.getTenantClient(ref.tenantSlug);
    const item = await client.meetingItem.findUnique({ where: { source_key: { source: ref.source, key: ref.key } } });
    return item?.currentSpaceId ? client.meetingSpace.findUnique({ where: { id: item.currentSpaceId } }) : null;
  }

  private emit(event: string, ref: MeetingRef, hostUserId: string): void {
    this.events.emit<MeetingEvent>(event, { tenantSlug: ref.tenantSlug, source: ref.source, key: ref.key, hostUserId, timestamp: new Date() });
  }

  /** `replaced`: the item has a new meeting with another host, rather than none */
  private emitCancelled(ref: MeetingRef, hostUserId: string, reason: string, replaced: boolean): void {
    this.events.emit<MeetingEvent>(SystemEvents.INTEGRATION_MEETING_CANCELLED, {
      tenantSlug: ref.tenantSlug, source: ref.source, key: ref.key, hostUserId, reason, replaced, timestamp: new Date(),
    });
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
