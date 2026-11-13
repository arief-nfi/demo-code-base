import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { RenderingController } from './rendering.controller';
import { RenderingService } from './rendering.service';

@Module({
  imports: [PrismaModule],
  controllers: [RenderingController],
  providers: [RenderingService],
  exports: [RenderingService],
})
export class RenderingModule {}
