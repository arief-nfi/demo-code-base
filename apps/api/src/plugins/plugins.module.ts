import { Module } from '@nestjs/common';
import { PluginLockService } from '@saas/backend';
import { PluginsService } from './plugins.service';
import { PluginsController } from './plugins.controller';
import { TenantPluginsController } from './tenant-plugins.controller';
import { TenantEnabledPluginsController } from './tenant-enabled-plugins.controller';

@Module({
  // TenantEnabledPluginsController must precede TenantPluginsController (route precedence for /tenant-plugins/enabled)
  controllers: [PluginsController, TenantEnabledPluginsController, TenantPluginsController],
  providers: [PluginsService, PluginLockService],
  exports: [PluginsService, PluginLockService],
})
export class PluginsModule {}
