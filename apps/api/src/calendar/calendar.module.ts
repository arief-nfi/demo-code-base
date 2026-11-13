import { Global, Module } from '@nestjs/common';
import { CALENDAR_SYNC } from '@saas/backend';
import { CalendarAccountController } from './calendar-account.controller';
import { CalendarProcessor } from './calendar.processor';
import { CalendarReplayJob } from './calendar-replay.job';
import { CalendarSyncService } from './calendar-sync.service';

/** Global so any module or plugin can inject CALENDAR_SYNC without importing core. */
@Global()
@Module({
  controllers: [CalendarAccountController],
  providers: [
    CalendarSyncService,
    { provide: CALENDAR_SYNC, useExisting: CalendarSyncService },
    CalendarProcessor,
    CalendarReplayJob,
  ],
  exports: [CALENDAR_SYNC],
})
export class CalendarModule {}
