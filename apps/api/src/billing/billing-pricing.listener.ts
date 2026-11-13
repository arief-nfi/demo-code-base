import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, SystemEvents, appRef } from '@saas/backend';
import type { AppEventPayload, PluginEventPayload } from '@saas/backend';
import { SubscriptionsService } from './subscriptions.service';

/** Applies a sysadmin's plugin or app pricing change to existing subscriptions. */
@Injectable()
export class BillingPricingListener {
  private readonly logger = new Logger(BillingPricingListener.name);

  constructor(private readonly subscriptions: SubscriptionsService) {}

  @OnEvent(SystemEvents.PLUGIN_PRICING_UPDATED)
  async onPricingUpdated(payload: PluginEventPayload): Promise<void> {
    try {
      await this.subscriptions.applyPricingChange(payload.pluginKey);
    } catch (error) {
      this.logger.error(`Applying the pricing change of "${payload.pluginKey}" failed`, error instanceof Error ? error.stack : error);
    }
  }

  @OnEvent(SystemEvents.APP_PRICING_UPDATED)
  async onAppPricingUpdated(payload: AppEventPayload): Promise<void> {
    try {
      await this.subscriptions.applyPricingChange(appRef(payload.appKey));
    } catch (error) {
      this.logger.error(`Applying the pricing change of app "${payload.appKey}" failed`, error instanceof Error ? error.stack : error);
    }
  }
}
