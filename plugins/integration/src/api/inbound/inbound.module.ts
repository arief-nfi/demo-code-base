import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { InboundController } from './inbound.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [PrismaModule, ApiKeysModule, WebhooksModule],
  controllers: [InboundController],
})
export class InboundModule {}
