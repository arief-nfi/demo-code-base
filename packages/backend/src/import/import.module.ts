import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ImportService } from './import.service';
import { ImportProcessor } from './import.processor';
import { ImportController } from './import.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ImportController],
  providers: [ImportService, ImportProcessor],
  exports: [ImportService],
})
export class ImportModule {}
