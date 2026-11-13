import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'crypto';
import {
  CacheService,
  CALENDAR_PROVIDER,
  isValidTimeZone,
  JOB_NAMES,
  normalizeCalendarEvent,
  PluginAccess,
  PrismaService,
  QUEUE_NAMES,
  RETRY_POLICIES,
  validateCalendarRef,
  type CalendarEventInput,
  type CalendarRef,
  type CalendarRequest,
  type CalendarSyncStatus,
  type ICalendarProvider,
  type ICalendarSync,
} from '@saas/backend';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const toRef = ({ tenantSlug, userId, source, key }: CalendarRef): CalendarRef => ({ tenantSlug, userId, source, key });

/**
 * One waiting job per event, so a burst of updates collapses into one. BullMQ ids can't
 * contain ':'; the hash keeps refs apart that differ only in the replaced characters.
 */
function calendarJobId(ref: CalendarRef): string {
  const readable = `${ref.tenantSlug}-${ref.source}-${ref.key}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 100);
  const hash = createHash('sha256').update(JSON.stringify([ref.tenantSlug, ref.userId, ref.source, ref.key])).digest('hex');
  return `${readable}-${hash.slice(0, 16)}`;
}

/**
 * The one way to put items on users' calendars. Records each request through the
 * provider (so requests made while syncing is paused are replayed later) and queues a
 * reference to it; CalendarProcessor applies it, so callers never wait for the provider.
 */
@Injectable()
export class CalendarSyncService implements ICalendarSync {
  private readonly logger = new Logger(CalendarSyncService.name);
  private readonly access: PluginAccess;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.CALENDAR) private readonly queue: Queue,
    private readonly moduleRef: ModuleRef,
    cache: CacheService,
  ) {
    this.access = new PluginAccess(prisma, cache);
  }

  async upsert(input: CalendarRef & CalendarEventInput): Promise<{ status: CalendarSyncStatus }> {
    validateCalendarRef(input);
    // The tenant's zone is only needed when the caller gave none
    const defaultZone = input.timeZone === undefined ? await this.tenantTimeZone(input.tenantSlug) : 'UTC';
    const event = normalizeCalendarEvent(input, defaultZone);
    return this.submit({ ...toRef(input), op: 'upsert', event });
  }

  async remove(ref: CalendarRef): Promise<{ status: CalendarSyncStatus }> {
    validateCalendarRef(ref);
    return this.submit({ ...toRef(ref), op: 'remove' });
  }

  async resync(tenantSlug: string, userId?: string): Promise<number> {
    const provider = this.provider();
    if (!provider?.isConfigured() || !(await this.canSync(provider, tenantSlug))) return 0;
    let queued = 0;
    for (const ref of await provider.pendingRefs(tenantSlug, userId)) {
      if (await this.enqueue(toRef(ref))) queued++;
    }
    return queued;
  }

  private async submit(request: CalendarRequest): Promise<{ status: CalendarSyncStatus }> {
    const provider = this.provider();
    if (!provider?.isConfigured()) return { status: 'not-configured' };

    const connection = await provider.record(request);
    if (connection === 'none') return { status: 'not-connected' };
    // Recorded from here on: replayed once syncing can resume
    if (!(await this.canSync(provider, request.tenantSlug))) return { status: 'disabled' };
    if (connection === 'paused-reconnect') return { status: 'not-connected' };

    await this.enqueue(toRef(request));
    return { status: 'queued' };
  }

  private provider(): ICalendarProvider | null {
    try {
      return this.moduleRef.get<ICalendarProvider>(CALENDAR_PROVIDER, { strict: false });
    } catch {
      return null; // no plugin provides a calendar
    }
  }

  private async canSync(provider: ICalendarProvider, tenantSlug: string): Promise<boolean> {
    return (await this.access.check(provider.pluginKey, tenantSlug)).ok && (await provider.isEnabledFor(tenantSlug));
  }

  private async tenantTimeZone(tenantSlug: string): Promise<string> {
    const config = await this.prisma.getTenantClient(tenantSlug).tenantConfig.findFirst({ select: { timezone: true } });
    const zone = config?.timezone;
    return isValidTimeZone(zone) ? zone : 'UTC';
  }

  /** False when Redis is unreachable: the request stays recorded and the replay sweep queues it. */
  private async enqueue(ref: CalendarRef): Promise<boolean> {
    const jobId = calendarJobId(ref);
    try {
      // BullMQ ignores an add whose id a kept failed job still holds: clear it so this request runs
      const previous = await this.queue.getJob(jobId);
      if (previous && (await previous.isFailed())) await previous.remove();
      await this.queue.add(JOB_NAMES.SYNC_CALENDAR_EVENT, ref, {
        jobId,
        removeOnComplete: true,
        removeOnFail: { count: 500 },
        ...RETRY_POLICIES.calendar,
      });
      return true;
    } catch (error) {
      this.logger.warn(`Could not queue calendar sync ${jobId}, the replay sweep will: ${errorText(error)}`);
      return false;
    }
  }
}
