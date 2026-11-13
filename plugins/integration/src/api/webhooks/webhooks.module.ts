import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookEventListenerService } from './webhook-event-listener.service';

@Module({
  imports: [PrismaModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryService, WebhookEventListenerService],
  exports: [WebhooksService, WebhookDeliveryService],
})
export class WebhooksModule {}
