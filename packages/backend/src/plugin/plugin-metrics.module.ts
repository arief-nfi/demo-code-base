import { Global, Module } from '@nestjs/common';
import { PluginMetricsService } from './plugin-metrics.service';

@Global()
@Module({
  providers: [PluginMetricsService],
  exports: [PluginMetricsService],
})
export class PluginMetricsModule {}
