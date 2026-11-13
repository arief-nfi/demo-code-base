import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { NotificationModule } from '../notifications/notification.module';
import { PluginsModule } from '../plugins/plugins.module';
import { AppContentsListener } from './app-contents.listener';
import { AppsCatalogService } from './apps-catalog.service';
import { AppsController } from './apps.controller';
import { TenantAppsController } from './tenant-apps.controller';
import { TenantAppsService } from './tenant-apps.service';

/** Apps: bundles of plugins sold at their own price (catalog, tenant store, content changes). */
@Module({
  // PluginsModule: the one PluginLockService instance billing locks with
  imports: [BillingModule, NotificationModule, PluginsModule],
  controllers: [AppsController, TenantAppsController],
  providers: [AppsCatalogService, AppContentsListener, TenantAppsService],
})
export class AppsModule {}
