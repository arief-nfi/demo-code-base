import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import { Job, UnrecoverableError } from 'bullmq';
import { CALENDAR_PROVIDER, isCalendarError, QUEUE_NAMES, type CalendarRef, type ICalendarProvider } from '@saas/backend';

/**
 * Applies queued calendar events through the provider. Jobs carry only a reference:
 * the provider applies the event's current requested state, so a late or repeated job
 * is harmless.
 */
@Processor(QUEUE_NAMES.CALENDAR, { concurrency: 5, limiter: { max: 10, duration: 1000 } })
export class CalendarProcessor extends WorkerHost {
  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  async process(job: Job<CalendarRef>): Promise<void> {
    let provider: ICalendarProvider;
    try {
      provider = this.moduleRef.get<ICalendarProvider>(CALENDAR_PROVIDER, { strict: false });
    } catch {
      return; // the provider's plugin is gone: the request stays recorded for when it is back
    }

    try {
      await provider.apply(job.data);
    } catch (error) {
      // Retrying won't help (access revoked, event rejected): fail now
      if (isCalendarError(error, 'CALENDAR_PERMANENT')) throw new UnrecoverableError((error as Error).message);
      throw error; // BullMQ retries per RETRY_POLICIES.calendar
    }
  }
}
