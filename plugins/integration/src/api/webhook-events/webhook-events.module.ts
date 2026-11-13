import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { WebhookEventsController } from './webhook-events.controller';
import { WebhookEventsService } from './webhook-events.service';

@Module({
  imports: [PrismaModule],
  controllers: [WebhookEventsController],
  providers: [WebhookEventsService],
  exports: [WebhookEventsService],
})
export class WebhookEventsModule {}
