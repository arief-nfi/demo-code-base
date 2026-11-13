import { Inject, Injectable, Logger } from '@nestjs/common';
import { PluginEventService, PrismaService, SystemEvents, type MeetingEvent } from '@saas/backend';
import { GOOGLE_API, GoogleApiError, type GoogleApi } from './google-api';

/** A final lock (the token is about to go away) tries this often, about 5 s in all */
const FINAL_DELAYS_MS = [0, 1_000, 3_000];
/** ...and starts no new round after this, so whoever waits gets an answer in seconds */
const FINAL_BUDGET_MS = 5_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type LockMode = 'retry-later' | 'final';
export type LockResult = 'LOCKED' | 'PENDING' | 'FAILED';

type SpaceRef = { id: string; spaceName: string };

/**
 * Meetings the app stops managing are locked first: only invitees join without knocking,
 * and a meeting in progress ends. A lock that can't be applied is retried later while the
 * host stays connected (PENDING), or recorded as FAILED when no connection is left.
 * Needs no ConnectionsService: callers bring the host's access token.
 */
@Injectable()
export class MeetSpacesService {
  private readonly logger = new Logger(MeetSpacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GOOGLE_API) private readonly google: GoogleApi,
    private readonly events: PluginEventService,
  ) {}

  async lock(tenantSlug: string, token: string | null, space: SpaceRef, mode: LockMode): Promise<LockResult> {
    return (await this.lockAll(tenantSlug, token, [space], mode))[0];
  }

  /**
   * Locks the spaces together: each round tries every space still open at once, and a final
   * lock retries only what Google may still accept (busy, unreachable) within its budget.
   */
  private async lockAll(tenantSlug: string, token: string | null, spaces: SpaceRef[], mode: LockMode): Promise<LockResult[]> {
    const errors = new Map<string, string>(spaces.map((space) => [space.id, "The host's Google access isn't available"]));
    let open = token ? spaces : [];
    const started = this.now();
    for (const delay of mode === 'final' ? FINAL_DELAYS_MS : [0]) {
      if (open.length === 0) break;
      if (delay) {
        if (this.now() - started >= FINAL_BUDGET_MS) break;
        await this.sleep(delay);
      }
      const failures = await Promise.all(open.map((space) => this.attempt(token!, space)));
      open = open.filter((space, index) => {
        const failure = failures[index];
        if (!failure) errors.delete(space.id);
        else errors.set(space.id, errorText(failure));
        return !!failure && failure instanceof GoogleApiError && failure.code === 'RETRYABLE';
      });
    }
    return Promise.all(
      spaces.map(async (space) => {
        const lastError = errors.get(space.id) ?? null;
        const lockState: LockResult = !lastError ? 'LOCKED' : mode === 'final' ? 'FAILED' : 'PENDING';
        await this.spaces(tenantSlug).update({ where: { id: space.id }, data: { lockState, lastError } });
        return lockState;
      }),
    );
  }

  /** One try at locking a space: null when it worked, else what went wrong */
  private async attempt(token: string, space: SpaceRef): Promise<unknown> {
    try {
      await this.google.setSpaceAccess(token, space.spaceName, 'RESTRICTED');
      await this.google.endActiveConference(token, space.spaceName);
      return null;
    } catch (error) {
      return error;
    }
  }

  /**
   * The host can no longer be used (disconnected, left, switched accounts): lock their
   * meetings with the token they still have (null when it's gone) and orphan the active ones.
   */
  async lockHostSpaces(tenantSlug: string, userId: string, token: string | null, reason: string): Promise<void> {
    const spaces = await this.spaces(tenantSlug).findMany({
      where: { hostUserId: userId, OR: [{ status: 'ACTIVE' }, { lockState: 'PENDING' }] },
      include: { item: true },
    });
    try {
      await this.lockAll(tenantSlug, token, spaces.filter((space: { lockState: string }) => space.lockState !== 'LOCKED'), 'final');
    } catch (error) {
      this.logger.warn(`Meetings of user ${userId} in ${tenantSlug} could not all be locked: ${errorText(error)}`);
    }
    for (const space of spaces) {
      if (space.status !== 'ACTIVE') continue;
      try {
        await this.spaces(tenantSlug).update({ where: { id: space.id }, data: { status: 'ORPHANED' } });
        this.events.emit<MeetingEvent>(SystemEvents.INTEGRATION_MEETING_ORPHANED, {
          tenantSlug, source: space.item.source, key: space.item.key, hostUserId: userId, reason, timestamp: new Date(),
        });
      } catch (error) {
        this.logger.warn(`Meeting ${space.id} of user ${userId} in ${tenantSlug} could not be closed: ${errorText(error)}`);
      }
    }
  }

  /** Locks the host's PENDING meetings owned by this Google account; others can never be locked now */
  async retryPending(tenantSlug: string, userId: string, token: string, accountId: string): Promise<number> {
    const spaces = await this.spaces(tenantSlug).findMany({ where: { hostUserId: userId, lockState: 'PENDING' } });
    const owned = spaces.filter((space: { hostAccountId: string }) => space.hostAccountId === accountId);
    for (const space of spaces) {
      if (owned.includes(space)) continue;
      await this.spaces(tenantSlug).update({
        where: { id: space.id },
        data: { lockState: 'FAILED', lastError: 'The Google account that owns this meeting is no longer connected' },
      });
    }
    return (await this.lockAll(tenantSlug, token, owned, 'retry-later')).filter((state) => state === 'LOCKED').length;
  }

  /** No connection is left for this host: their pending locks can't happen any more */
  async failPending(tenantSlug: string, userId: string, reason: string): Promise<void> {
    await this.spaces(tenantSlug).updateMany({ where: { hostUserId: userId, lockState: 'PENDING' }, data: { lockState: 'FAILED', lastError: reason } });
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected now(): number {
    return Date.now();
  }

  private spaces(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug).meetingSpace;
  }
}
