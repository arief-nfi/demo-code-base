import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { ImageProcessorService } from './image-processor.service';

@Module({
  imports: [PrismaModule],
  controllers: [UploadController],
  providers: [UploadService, ImageProcessorService],
  exports: [UploadService],
})
export class UploadModule {}
