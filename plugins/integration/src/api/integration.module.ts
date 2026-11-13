import { Module } from '@nestjs/common';
import { PartnersModule } from './partners/partners.module';
import { WebhookEventsModule } from './webhook-events/webhook-events.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { InboundModule } from './inbound/inbound.module';
import { GoogleCalendarModule } from './google-calendar/google-calendar.module';

@Module({
  imports: [PartnersModule, WebhookEventsModule, WebhooksModule, ApiKeysModule, InboundModule, GoogleCalendarModule],
})
export class IntegrationModule {}
