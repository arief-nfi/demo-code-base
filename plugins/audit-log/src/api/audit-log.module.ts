import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditModule } from '@saas/backend';

@Module({
  imports: [AuditModule],
  controllers: [AuditLogController],
})
export class AuditLogModule {}
