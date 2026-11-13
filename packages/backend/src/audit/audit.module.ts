import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditRetentionCron } from './audit-retention.cron';
import { AuditInterceptor } from './audit.interceptor';
import { AuditConfigService } from './audit-config.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditService, AuditRetentionCron, AuditInterceptor, AuditConfigService],
  exports: [AuditService, AuditRetentionCron, AuditInterceptor, AuditConfigService],
})
export class AuditModule {}
