import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  CacheService,
  MEETING_PROVIDER,
  PluginAccess,
  PrismaService,
  validateMeetingCreate,
  validateMeetingRef,
  type IMeetingProvider,
  type IMeetingService,
  type MeetingCancelResult,
  type MeetingCreateInput,
  type MeetingInfo,
  type MeetingRef,
  type MeetingResult,
} from '@saas/backend';

/** A caller waiting on a button click gets an answer within this */
const ANSWER_TIMEOUT_MS = 10_000;

/**
 * The one way to get a video meeting for an item. Synchronous: the caller gets the join
 * link in the same request. Creation needs the provider's plugin usable by the tenant, its
 * meetings switch on and the platform's credentials; reading and cancelling always work
 * (even without credentials), so meetings can be closed.
 */
@Injectable()
export class MeetingService implements IMeetingService {
  private readonly access: PluginAccess;

  constructor(
    prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    cache: CacheService,
  ) {
    this.access = new PluginAccess(prisma, cache);
  }

  async create(input: MeetingCreateInput): Promise<MeetingResult> {
    validateMeetingCreate(input);
    const provider = this.provider();
    if (!provider) return { status: 'not-configured' };
    if (!(await this.access.check(provider.pluginKey, input.tenantSlug)).ok || !(await provider.isEnabledFor(input.tenantSlug))) {
      return { status: 'disabled' };
    }

    return this.within(provider.create(input), { status: 'unavailable', message: 'Google took too long; try again.' });
  }

  async get(ref: MeetingRef): Promise<MeetingInfo | null> {
    validateMeetingRef(ref);
    return (await this.provider({ configured: false })?.get(ref)) ?? null;
  }

  async cancel(ref: MeetingRef): Promise<MeetingCancelResult> {
    validateMeetingRef(ref);
    const provider = this.provider({ configured: false });
    if (!provider) return { status: 'not-found', locked: false };
    // The provider records the cancel before asking Google, so a slow lock is finished later (the sweep)
    return this.within(provider.cancel(ref), { status: 'cancelled', locked: false });
  }

  /** For the sweep: locks the provider couldn't apply earlier */
  async retryPendingLocks(tenantSlug: string): Promise<number> {
    return (await this.provider()?.retryPendingLocks(tenantSlug)) ?? 0;
  }

  /** Callers get an answer in seconds: `fallback` when the provider is slower than that */
  private async within<T>(work: Promise<T>, fallback: T): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ANSWER_TIMEOUT_MS);
    });
    try {
      return await Promise.race([work, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The meetings plugin's provider; by default only while it has the platform's credentials */
  private provider(needs: { configured: boolean } = { configured: true }): IMeetingProvider | null {
    try {
      const provider = this.moduleRef.get<IMeetingProvider>(MEETING_PROVIDER, { strict: false });
      return !needs.configured || provider.isConfigured() ? provider : null;
    } catch {
      return null; // no plugin provides meetings
    }
  }
}
