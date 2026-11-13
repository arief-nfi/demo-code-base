import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { RequestContextService } from '../utils/request-context.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrismaService, RequestContextService],
  exports: [PrismaService, RequestContextService],
})
export class PrismaModule {}
