import { Module } from '@nestjs/common';
import { ImportUploadController } from './import-upload.controller';

@Module({
  controllers: [ImportUploadController],
})
export class ImportUploadModule {}
