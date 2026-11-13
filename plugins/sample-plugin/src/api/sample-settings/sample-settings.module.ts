import { Module } from '@nestjs/common';
import { SampleSettingsController } from './sample-settings.controller';
import { SampleSettingsService } from './sample-settings.service';

@Module({
  controllers: [SampleSettingsController],
  providers: [SampleSettingsService],
})
export class SampleSettingsModule {}
