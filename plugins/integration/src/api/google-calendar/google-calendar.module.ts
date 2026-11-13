import { Logger, Module } from '@nestjs/common';
import { CALENDAR_PROVIDER, MEETING_PROVIDER, PrismaModule } from '@saas/backend';
import { ConnectionsService } from './connections.service';
import { createGoogleApi, GOOGLE_API } from './google-api';
import { GOOGLE_CALENDAR_CONFIG, googleCalendarConfigFromEnv, type GoogleCalendarConfig } from './google-calendar.config';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarListener } from './google-calendar.listener';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { GoogleMeetProvider } from './google-meet.provider';
import { MeetSpacesService } from './meet-spaces.service';

/** Provides CALENDAR_PROVIDER and MEETING_PROVIDER, which core's calendar and meetings facades look up. */
@Module({
  imports: [PrismaModule],
  controllers: [GoogleCalendarController],
  providers: [
    {
      provide: GOOGLE_CALENDAR_CONFIG,
      useFactory: (): GoogleCalendarConfig => {
        const config = googleCalendarConfigFromEnv();
        if (!config.configured && (config.clientId || config.clientSecret || config.encryptionKey)) {
          new Logger('GoogleCalendar').warn(
            'Google Calendar is not configured: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a 32-byte base64 INTEGRATION_ENCRYPTION_KEY are all required',
          );
        }
        return config;
      },
    },
    { provide: GOOGLE_API, inject: [GOOGLE_CALENDAR_CONFIG], useFactory: (config: GoogleCalendarConfig) => createGoogleApi(config) },
    ConnectionsService,
    GoogleCalendarProvider,
    GoogleCalendarListener,
    { provide: CALENDAR_PROVIDER, useExisting: GoogleCalendarProvider },
    MeetSpacesService,
    GoogleMeetProvider,
    { provide: MEETING_PROVIDER, useExisting: GoogleMeetProvider },
  ],
  exports: [CALENDAR_PROVIDER, MEETING_PROVIDER],
})
export class GoogleCalendarModule {}
