import { Global, Module } from '@nestjs/common';
import { MEETINGS } from '@saas/backend';
import { MeetingLockJob } from './meeting-lock.job';
import { MeetingService } from './meeting.service';

/** Global so any module or plugin can inject MEETINGS without importing core. */
@Global()
@Module({
  providers: [MeetingService, { provide: MEETINGS, useExisting: MeetingService }, MeetingLockJob],
  exports: [MEETINGS],
})
export class MeetingsModule {}
