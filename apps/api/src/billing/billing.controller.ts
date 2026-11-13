import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RbacGuard, Roles, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { BillingSettingsService } from './billing-settings.service';
import { InvoiceService } from './invoice.service';
import { CheckoutService } from './checkout.service';
import { SubscriptionsService, type TenantSubscriptionRow } from './subscriptions.service';
import type { TenantSubscription } from '@saas/database';
import { Throttle } from '@nestjs/throttler';
import type { Invoice } from '@saas/database';
import { billingProfileSchema, type BillingProfileDto } from './billing.schemas';
import { isZero } from './money';
import { CreditService } from './credit.service';

/** Tenant admin billing: the caller's own tenant only (from x-tenant-id). */
@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('ADMIN')
export class BillingController {
  constructor(
    private readonly settings: BillingSettingsService,
    private readonly invoices: InvoiceService,
    private readonly checkout: CheckoutService,
    private readonly subscriptions: SubscriptionsService,
    private readonly credits: CreditService,
  ) {}

  private tenantOf(req: AuthenticatedRequest): { id: string; slug: string } {
    if (!req.tenant?.id) {
      throw new BadRequestException('Tenant context is required');
    }
    return { id: req.tenant.id, slug: req.tenant.slug };
  }

  @Get('profile')
  @ApiOperation({ summary: "Get the tenant's billing details" })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.settings.getProfile(this.tenantOf(req).id);
  }

  @Put('profile')
  @ApiOperation({ summary: "Update the tenant's billing details" })
  updateProfile(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(billingProfileSchema)) body: BillingProfileDto) {
    return this.settings.updateProfile(this.tenantOf(req).id, body);
  }

  @Get('invoices')
  @ApiOperation({ summary: "List the tenant's invoices" })
  listInvoices(@Req() req: AuthenticatedRequest): Promise<Invoice[]> {
    return this.invoices.listForTenant(this.tenantOf(req).id);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get one of the tenant\'s invoices' })
  getInvoice(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<Invoice> {
    return this.invoices.getForTenant(this.tenantOf(req).id, id);
  }

  @Get('config')
  @ApiOperation({ summary: 'Whether paid plugins can be bought, and how tax is shown' })
  async config(): Promise<{ checkoutAvailable: boolean; provider: string | null; tax: { enabled: boolean; name: string; rate: number } }> {
    const s = await this.settings.getSettings();
    return {
      checkoutAvailable: this.checkout.isAvailable(),
      provider: this.checkout.providerKey,
      tax: { enabled: s.taxEnabled, name: s.taxName, rate: s.taxRate },
    };
  }

  @Post('invoices/:id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a payment link for an open invoice' })
  pay(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<{ checkoutUrl: string }> {
    return this.checkout.createCheckout(this.tenantOf(req).id, id);
  }

  @Get('credit')
  @ApiOperation({ summary: "The tenant's credit, per currency (non-zero balances)" })
  credit(@Req() req: AuthenticatedRequest): Promise<Array<{ currency: string; amount: string }>> {
    return this.credits.balances(this.tenantOf(req).id);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: "The tenant's plugin and app subscriptions" })
  listSubscriptions(@Req() req: AuthenticatedRequest): Promise<TenantSubscriptionRow[]> {
    const tenant = this.tenantOf(req);
    return this.subscriptions.tenantSubscriptions(tenant.slug, tenant.id);
  }

  @Post('subscriptions/:pluginKey')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Subscribe to a plugin or an app (`app:<key>`); returns a payment link when there is something to pay' })
  async subscribe(
    @Req() req: AuthenticatedRequest,
    @Param('pluginKey') pluginKey: string,
  ): Promise<{ subscription: TenantSubscription; checkoutUrl: string | null; failedPlugins: string[] }> {
    const tenant = this.tenantOf(req);
    const { subscription, invoiceId, failedPlugins } = await this.subscriptions.subscribe(tenant.slug, tenant.id, pluginKey, req.user?.userId);
    // An invoice fully covered by credit is settled automatically: nothing to pay
    const invoice = invoiceId ? await this.invoices.getForTenant(tenant.id, invoiceId) : null;
    const checkoutUrl = invoice && !isZero(invoice.total, invoice.currency) ? (await this.checkout.createCheckout(tenant.id, invoice.id)).checkoutUrl : null;
    // An app's plugins that couldn't be switched on (free app or trial); the tenant can retry from Tenant Plugins
    return { subscription, checkoutUrl, failedPlugins };
  }

  @Post('subscriptions/:pluginKey/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Cancel: active plans stop at the period end, anything else ends now' })
  cancel(@Req() req: AuthenticatedRequest, @Param('pluginKey') pluginKey: string): Promise<TenantSubscription> {
    const tenant = this.tenantOf(req);
    return this.subscriptions.cancel(tenant.slug, tenant.id, pluginKey, req.user?.userId);
  }

  @Post('subscriptions/:pluginKey/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo a scheduled cancellation' })
  resume(@Req() req: AuthenticatedRequest, @Param('pluginKey') pluginKey: string): Promise<TenantSubscription> {
    return this.subscriptions.resume(this.tenantOf(req).slug, pluginKey);
  }
}
