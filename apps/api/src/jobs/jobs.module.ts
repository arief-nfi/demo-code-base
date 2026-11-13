import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { PrismaModule, PrismaService, QUEUE_NAMES } from '@saas/backend';
import { JwtService } from '@nestjs/jwt';
import { bullBoardAuth } from './bull-board-auth';

import { WebhookProducer } from './webhook/webhook.producer';
import { WebhookProcessor } from './webhook/webhook.processor';
import { ExportProducer } from './export/export.producer';
import { ExportProcessor } from './export/export.processor';
import { JobsController } from './jobs.controller';

@Module({
  imports: [
    PrismaModule,
    BullBoardModule.forRootAsync({
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const jwt = new JwtService({ secret: process.env.JWT_SECRET });
        return {
          route: '/admin/queues',
          adapter: ExpressAdapter,
          middleware: bullBoardAuth({
            verify: (token) => jwt.verify<{ sub: string; tenantSlug?: string }>(token),
            isSysadmin: async (userId, tenantSlug) => {
              const client = tenantSlug ? prisma.getTenantClient(tenantSlug) : prisma;
              const user = await client.user.findUnique({ where: { id: userId }, include: { roles: true } });
              return !!user?.roles.some((r) => r.name.toUpperCase() === 'SYSADMIN');
            },
          }),
        };
      },
    }),
    BullBoardModule.forFeature({
      name: QUEUE_NAMES.EMAIL,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QUEUE_NAMES.WEBHOOK,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QUEUE_NAMES.EXPORT,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QUEUE_NAMES.CALENDAR,
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [JobsController],
  providers: [
    WebhookProducer,
    WebhookProcessor,
    ExportProducer,
    ExportProcessor,
  ],
  exports: [WebhookProducer, ExportProducer],
})
export class JobsModule {}
