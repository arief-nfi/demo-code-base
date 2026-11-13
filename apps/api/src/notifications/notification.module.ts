import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationListenerService } from './notification-listener.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationListenerService],
  exports: [NotificationService],
})
export class NotificationModule {}
