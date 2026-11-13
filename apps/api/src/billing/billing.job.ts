import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CacheService,
  PluginEventService,
  PluginLockService,
  PrismaService,
  SystemEvents,
  appKeyOf,
} from '@saas/backend';
import type { BillingEventPayload } from '@saas/backend';
import type { Invoice, InvoiceKind, TenantSubscription } from '@saas/database';
import { BillingSettingsService, type BillingSettingsView } from './billing-settings.service';
import { CatalogService } from './catalog.service';
import { isZero } from './money';
import { CheckoutService } from './checkout.service';
import { InvoiceService } from './invoice.service';
import { normalizeLegacy, planSubscriptionActions, type JobAction } from './lifecycle';
import { addHours, addPeriod, continuationAnchorDay } from './periods';
import { SubscriptionsService } from './subscriptions.service';

export interface BillingJobResult {
  tenants: number;
  actions: number;
  errors: { tenantSlug: string; error: string }[];
  /** True when another run was still in progress. */
  skipped: boolean;
}

interface TenantRef {
  id: string;
  slug: string;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The hourly billing run: renewal and trial-conversion invoices, past due →
 * paused, scheduled ends, pre-billing (legacy) subscriptions, stale payment links.
 * Only tenants that can use the app (ACTIVE, TRIAL) are processed; others keep
 * their dates and are caught up — without backfilling — once reactivated.
 */
@Injectable()
export class BillingJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginLock: PluginLockService,
    private readonly subscriptions: SubscriptionsService,
    private readonly invoices: InvoiceService,
    private readonly checkout: CheckoutService,
    private readonly settings: BillingSettingsService,
    private readonly pluginEventService: PluginEventService,
    private readonly cache: CacheService,
    private readonly catalog: CatalogService,
  ) {}

  /**
   * Run once at startup, in the background: after a deploy, tenants already using a
   * plugin that became paid get their trial now instead of being blocked by the
   * paywall until the first hourly run.
   */
  onApplicationBootstrap(): void {
    void this.run().catch((error) => this.logger.error(`Startup billing run failed: ${message(error)}`));
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const result = await this.run();
    if (result.errors.length) {
      this.logger.warn(`Billing run finished with ${result.errors.length} error(s): ${JSON.stringify(result.errors)}`);
    }
  }

  async run(now: Date = new Date()): Promise<BillingJobResult> {
    if (this.running) {
      this.logger.warn('Billing job already running — skipping');
      return { tenants: 0, actions: 0, errors: [], skipped: true };
    }
    this.running = true;
    const result: BillingJobResult = { tenants: 0, actions: 0, errors: [], skipped: false };

    try {
      const settings = await this.settings.getSettings();
      // Plugins and apps (`app:<key>`) alike
      const models = await this.catalog.pricingModels();
      const tenants = await this.prisma.tenant.findMany({
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
        select: { id: true, slug: true },
      });
      result.tenants = tenants.length;

      for (const tenant of tenants) {
        try {
          // Before the per-subscription locks: tenants using a plugin that became paid get their trial
          result.actions += await this.subscriptions.grantTrialsForNowPaidPlugins(tenant.slug, now);
          result.actions += await this.subscriptions.grantTrialsForNowPaidApps(tenant.slug, now);
          const subs = await this.prisma.getTenantClient(tenant.slug).tenantSubscription.findMany();
          for (const sub of subs) {
            try {
              result.actions += await this.processSubscription(tenant, sub.pluginKey, models, settings, now);
            } catch (error) {
              result.errors.push({ tenantSlug: tenant.slug, error: `${sub.pluginKey}: ${message(error)}` });
            }
          }
        } catch (error) {
          result.errors.push({ tenantSlug: tenant.slug, error: message(error) });
        }
      }

      result.actions += await this.settleCreditedInvoices(now, result);
      await this.checkout.expireStale(now);
    } finally {
      this.running = false;
    }
    return result;
  }

  private processSubscription(
    tenant: TenantRef,
    pluginKey: string,
    models: Map<string, string>,
    settings: BillingSettingsView,
    now: Date,
  ): Promise<number> {
    return this.pluginLock.withLock(`toggle:${tenant.slug}:${pluginKey}`, async () => {
      const client = this.prisma.getTenantClient(tenant.slug);
      let sub = await client.tenantSubscription.findUnique({ where: { pluginKey } });
      if (!sub) return 0;
      const pluginModel = models.get(pluginKey) ?? 'FREE';
      const pluginIsPaid = pluginModel !== 'FREE';
      let count = 0;

      const legacy = normalizeLegacy(sub, now);
      if (legacy) {
        const previousEnd = sub.endDate;
        sub = (await client.tenantSubscription.update({ where: { pluginKey }, data: legacy.patch })) as TenantSubscription;
        count++;
        if (legacy.issueFirst && pluginIsPaid) {
          await this.issue(tenant, pluginKey, pluginModel === 'ONE_TIME' ? 'ONE_TIME' : 'FIRST', sub.startDate, null, null, addHours(now, 24), now);
        }
        if (legacy.issueLapsedRenewal && pluginIsPaid) {
          const anchor = sub.currentPeriodEnd ?? previousEnd ?? now;
          const invoice = await this.issue(tenant, pluginKey, 'RENEWAL', anchor, null, null, now, now);
          this.emit(SystemEvents.BILLING_SUBSCRIPTION_PAST_DUE, tenant.slug, pluginKey, invoice, now);
        }
      }

      const open = await this.invoices.findOpenForSubscription(tenant.id, pluginKey);
      const actions = planSubscriptionActions(sub, {
        now,
        renewalLeadDays: settings.renewalLeadDays,
        graceDays: settings.graceDays,
        pluginIsPaid,
        openInvoice: open,
      });

      let invoice: Invoice | null = open;
      const anchorDay = sub.currentPeriodEnd ? continuationAnchorDay(sub.currentPeriodStart, sub.currentPeriodEnd) : undefined;
      for (const action of actions) {
        // An invoice the credit fully covers is settled once this lock is released (or at the end of this run): nothing is overdue
        const overdue = action.type === 'MARK_PAST_DUE' || action.type === 'PAUSE';
        if (overdue && invoice && isZero(invoice.total, invoice.currency)) continue;
        invoice = (await this.execute(tenant, pluginKey, pluginModel, action, invoice, now, anchorDay)) ?? invoice;
        count++;
      }
      if (count) await this.cache.del(`plugin:tenant:${tenant.slug}:${pluginKey}`);
      return count;
    });
  }

  private async execute(
    tenant: TenantRef,
    pluginKey: string,
    pluginModel: string,
    action: JobAction,
    openInvoice: Invoice | null,
    now: Date,
    anchorDay?: number,
  ): Promise<Invoice | null> {
    const client = this.prisma.getTenantClient(tenant.slug);
    switch (action.type) {
      case 'ISSUE_INVOICE': {
        const recurring = pluginModel === 'MONTHLY' || pluginModel === 'YEARLY';
        const periodEnd =
          action.periodStart && recurring
            ? addPeriod(action.periodStart, pluginModel as 'MONTHLY' | 'YEARLY', action.kind === 'RENEWAL' ? anchorDay : undefined)
            : null;
        return this.issue(tenant, pluginKey, action.kind, action.anchor, action.periodStart, periodEnd, action.dueAt, now);
      }
      case 'MARK_PAST_DUE':
        await client.tenantSubscription.update({ where: { pluginKey }, data: { status: 'PAST_DUE', pastDueAt: now } });
        this.emit(SystemEvents.BILLING_SUBSCRIPTION_PAST_DUE, tenant.slug, pluginKey, openInvoice, now);
        return null;
      case 'PAUSE': {
        await client.tenantSubscription.update({ where: { pluginKey }, data: { status: 'PAUSED', pausedAt: now } });
        const switchedOff = await this.switchOff(tenant.slug, pluginKey);
        // An app's notice names the plugins it switched off
        this.emit(SystemEvents.BILLING_SUBSCRIPTION_PAUSED, tenant.slug, pluginKey, openInvoice, now, appKeyOf(pluginKey) !== null ? { switchedOff } : {});
        return null;
      }
      case 'END':
        await client.tenantSubscription.update({
          where: { pluginKey },
          data: { status: 'ENDED', endedAt: now, cancelAtPeriodEnd: false },
        });
        // A renewal sent before the tenant cancelled must not stay open (and overdue) forever
        await this.subscriptions.voidOpenInvoices(tenant.id, pluginKey, now);
        await this.switchOff(tenant.slug, pluginKey);
        return null;
    }
  }

  private async issue(
    tenant: TenantRef,
    pluginKey: string,
    kind: InvoiceKind,
    anchor: Date,
    periodStart: Date | null,
    periodEnd: Date | null,
    dueAt: Date,
    now: Date,
  ): Promise<Invoice> {
    const { invoice, created } = await this.invoices.issueInvoice({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      pluginKey,
      kind,
      anchor,
      periodStart,
      periodEnd,
      dueAt,
      now,
    });
    if (created) this.emit(SystemEvents.BILLING_INVOICE_ISSUED, tenant.slug, pluginKey, invoice, now);
    return invoice;
  }

  /**
   * Open invoices the tenant's credit fully covers are settled by CreditSettlementListener right after
   * they are issued; this catches any it missed (a restart in between, a failed attempt). Runs outside
   * the product locks, which activateFromPayment takes itself.
   */
  private async settleCreditedInvoices(now: Date, result: BillingJobResult): Promise<number> {
    const open = await this.prisma.invoice.findMany({ where: { status: 'OPEN' } });
    let settled = 0;
    for (const invoice of open.filter((i) => isZero(i.total, i.currency))) {
      try {
        await this.subscriptions.activateFromPayment(invoice.id, { paidAt: now, provider: 'credit', method: 'credit', complimentary: false });
        settled++;
      } catch (error) {
        result.errors.push({ tenantSlug: invoice.tenantSlug, error: `${invoice.number}: ${message(error)}` });
      }
    }
    return settled;
  }

  /**
   * Switch the product off: a plugin through the shared core, forced off if the core refuses
   * (failing hook) — the period is over regardless; an app's plugins that nothing else grants.
   * Returns the plugins switched off.
   */
  private async switchOff(tenantSlug: string, pluginKey: string): Promise<string[]> {
    if (appKeyOf(pluginKey) !== null) return this.subscriptions.switchOffProduct(tenantSlug, pluginKey);
    // A live app grants the plugin: its own subscription ending changes nothing
    if (await this.subscriptions.grantedByApp(tenantSlug, pluginKey)) return [];
    try {
      return (await this.subscriptions.disablePluginForTenant(tenantSlug, pluginKey)) ? [pluginKey] : [];
    } catch (error) {
      this.logger.warn(`"${pluginKey}" for tenant ${tenantSlug}: clean disable failed (${message(error)}), forcing it off`);
      await this.prisma.getTenantClient(tenantSlug).plugin.updateMany({ where: { key: pluginKey }, data: { isEnabled: false } });
      this.pluginEventService.emit(SystemEvents.PLUGIN_DISABLED_TENANT, { tenantSlug, pluginKey, timestamp: new Date() });
      return [pluginKey];
    }
  }

  private emit(
    event: string,
    tenantSlug: string,
    pluginKey: string,
    invoice: Invoice | null,
    now: Date,
    extra: Pick<BillingEventPayload, 'switchedOff'> = {},
  ): void {
    const payload: BillingEventPayload = {
      tenantSlug,
      pluginKey,
      timestamp: now,
      ...(invoice
        ? { invoiceId: invoice.id, invoiceNumber: invoice.number, total: invoice.total.toString(), currency: invoice.currency }
        : {}),
      ...extra,
    };
    this.pluginEventService.emit(event, payload);
  }
}
