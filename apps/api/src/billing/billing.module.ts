import { Logger, Module } from '@nestjs/common';
import { PluginsModule } from '../plugins/plugins.module';
import { NotificationModule } from '../notifications/notification.module';
import { BillingSettingsService } from './billing-settings.service';
import { InvoiceService } from './invoice.service';
import { CheckoutService } from './checkout.service';
import { CreditService } from './credit.service';
import { AppPluginsService } from './app-plugins.service';
import { CatalogService } from './catalog.service';
import { CreditSettlementListener } from './credit-settlement.listener';
import { SubscriptionsService } from './subscriptions.service';
import { BillingJob } from './billing.job';
import { BillingPricingListener } from './billing-pricing.listener';
import { BillingTenantListener } from './billing-tenant.listener';
import { BillingRecipientsService } from './billing-recipients.service';
import { BillingNotificationsListener } from './billing-notifications.listener';
import { BillingController } from './billing.controller';
import { BillingAdminController } from './billing-admin.controller';
import { BillingPublicController } from './billing-public.controller';
import { BILLING_PROVIDER, PAYMENT_ACTIVATOR } from './providers/payment-provider';
import { resolveProvider } from './providers/resolve-provider';

@Module({
  imports: [PluginsModule, NotificationModule],
  // BillingAdminController first: its static `billing/admin/*` routes must win over BillingController's params
  controllers: [BillingAdminController, BillingController, BillingPublicController],
  providers: [
    BillingSettingsService,
    InvoiceService,
    CheckoutService,
    CreditService,
    CatalogService,
    AppPluginsService,
    SubscriptionsService,
    BillingJob,
    BillingPricingListener,
    BillingTenantListener,
    BillingRecipientsService,
    BillingNotificationsListener,
    CreditSettlementListener,
    {
      provide: BILLING_PROVIDER,
      useFactory: () =>
        resolveProvider(
          {
            BILLING_PROVIDER: process.env.BILLING_PROVIDER,
            BILLING_FAKE_ALLOWED: process.env.BILLING_FAKE_ALLOWED,
            NODE_ENV: process.env.NODE_ENV,
            FRONTEND_URL: process.env.FRONTEND_URL,
            BILLING_CALLBACK_TOKEN: process.env.BILLING_CALLBACK_TOKEN,
          },
          new Logger('Billing'),
        ),
    },
    { provide: PAYMENT_ACTIVATOR, useExisting: SubscriptionsService },
  ],
  exports: [SubscriptionsService, CatalogService, CreditService, InvoiceService, AppPluginsService],
})
export class BillingModule {}
