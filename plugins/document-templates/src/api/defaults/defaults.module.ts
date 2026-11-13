import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { DefaultsController } from './defaults.controller';
import { DefaultsService } from './defaults.service';

@Module({
  imports: [PrismaModule],
  controllers: [DefaultsController],
  providers: [DefaultsService],
  exports: [DefaultsService],
})
export class DefaultsModule {}
