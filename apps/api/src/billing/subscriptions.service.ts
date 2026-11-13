import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PrismaService,
  CacheService,
  PluginEventService,
  SystemEvents,
  PluginLockService,
  appKeyOf,
  appRef,
  grantingAppRefs,
  isSubscriptionLive,
} from '@saas/backend';
import type { BillingEventPayload, PluginSubscribedPayload, SubscriptionReplacedPayload } from '@saas/backend';
import type { Invoice, TenantSubscription } from '@saas/database';
import { PluginsService } from '../plugins/plugins.service';
import { BillingSettingsService } from './billing-settings.service';
import { InvoiceService, invoiceDedupeKey } from './invoice.service';
import { CreditService } from './credit.service';
import { CatalogService, type Product } from './catalog.service';
import { AppPluginsService, switchOffOrder } from './app-plugins.service';
import { replacementFor } from './replacement';
import { applyPayment, type InvoiceKindName } from './lifecycle';
import { addDays, addHours } from './periods';
import { PAID_PLUGINS_UNAVAILABLE } from './checkout.service';
import {
  BILLING_PROVIDER,
  type PaymentActivator,
  type PaymentDetails,
  type PaymentProvider,
} from './providers/payment-provider';

const DAY_MS = 24 * 60 * 60 * 1000;
/** New subscriptions: the first invoice is due a day after subscribing. */
const FIRST_INVOICE_DUE_HOURS = 24;
/** A plugin that became paid gives its existing users this long when it has no trial of its own. */
const FREE_TO_PAID_TRIAL_DAYS = 14;
/** Subscriptions that become free and unending when their plugin is made free. */
const FREE_CONVERTIBLE = ['TRIAL', 'PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'PAUSED'];
/** A payment for a plan in these states continues it; the plugin's on/off switch is left as the tenant set it. */
const STILL_RUNNING = ['ACTIVE', 'PAST_DUE', 'TRIAL'];
/** States in which cancelling ends the subscription right away. */
const END_NOW_ON_CANCEL = ['TRIAL', 'PENDING_PAYMENT', 'PAST_DUE', 'PAUSED'];

export interface TenantSubscriptionRow {
  /** Product key: a plugin key, or `app:<appKey>`. */
  pluginKey: string;
  /** The plugin's or the app's name. */
  pluginName: string;
  kind: 'plugin' | 'app';
  /** App rows: names of the plugins it grants; plugin rows: []. */
  includes: string[];
  /** App rows: names of the plugins that switch off when it ends (nothing else grants them, or they need one that does); plugin rows: []. */
  switchesOff: string[];
  status: string;
  /** `OWNED` for a paid one-time purchase, otherwise `status`. */
  displayStatus: string;
  pricingModel: string;
  price: string | null;
  currency: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  /** A scheduled end the tenant can still undo (not when an administrator voided the renewal). */
  resumable: boolean;
  nextInvoiceAt: Date | null;
  openInvoiceId: string | null;
}

/**
 * Plugin subscriptions (tenant schema) and their billing lifecycle. A paid plugin
 * is switched on by paying its invoice (activateFromPayment) and off when the
 * subscription pauses or ends. Every change runs under `toggle:<slug>:<key>`.
 */
@Injectable()
export class SubscriptionsService implements PaymentActivator {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly pluginEventService: PluginEventService,
    private readonly pluginLock: PluginLockService,
    private readonly pluginsService: PluginsService,
    private readonly invoices: InvoiceService,
    private readonly settings: BillingSettingsService,
    @Inject(BILLING_PROVIDER) private readonly provider: PaymentProvider | null,
    private readonly credits: CreditService,
    private readonly catalog: CatalogService,
    private readonly appPlugins: AppPluginsService,
  ) {}

  /**
   * Subscribe to a product — a plugin or an app (`app:<key>`). FREE → ACTIVE and on;
   * a trial (if it has one and this tenant hasn't used it) → TRIAL and on; otherwise
   * PENDING_PAYMENT with a first invoice, whose id is returned so the caller can
   * create a payment link. An app switches its plugins on; one that fails doesn't
   * undo the subscription and is reported in `failedPlugins`.
   */
  async subscribe(
    tenantSlug: string,
    tenantId: string,
    productKey: string,
    userId?: string,
  ): Promise<{ subscription: TenantSubscription; invoiceId: string | null; failedPlugins: string[] }> {
    return this.pluginLock.withLock(`toggle:${tenantSlug}:${productKey}`, async () => {
      const product = await this.catalog.getProduct(productKey);
      if (!product) throw new BadRequestException(`"${productKey}" is not available.`);
      const isApp = product.kind === 'app';

      const tenantClient = this.prisma.getTenantClient(tenantSlug);
      if (!isApp) await this.assertNotGrantedByApp(tenantClient, product);
      const existing = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey: productKey } });

      if (existing?.status === 'PENDING_PAYMENT' || existing?.status === 'PAUSED') {
        // Subscribing again while an invoice is unpaid: hand back that invoice (paying it resumes a paused plan).
        const open = await this.invoices.findOpenForSubscription(tenantId, productKey);
        if (open || existing.status === 'PENDING_PAYMENT') {
          return { subscription: existing, invoiceId: open?.id ?? null, failedPlugins: [] };
        }
      }
      // Off sale (a hidden app, a plugin switched off): nothing new — an invoice the tenant still owes is handed back above
      if (!product.available) throw new BadRequestException(`"${productKey}" is not available.`);
      if (existing && isSubscriptionLive(existing)) {
        throw new BadRequestException(`Already subscribed to "${productKey}".`);
      }

      const pricingModel = product.pricingModel;
      const now = new Date();
      // One trial per product per tenant: a prior subscription with trialEndsAt set has used it up
      const trialUsed = existing?.trialEndsAt != null;
      const isFree = pricingModel === 'FREE';
      const startsTrial = !isFree && product.trialDays > 0 && !trialUsed;

      // Nothing paid at all (trials included) until a payment provider exists:
      // a trial would end in an invoice nobody can pay.
      if (!isFree && !this.provider) {
        throw new ServiceUnavailableException(PAID_PLUGINS_UNAVAILABLE);
      }

      const status = isFree ? 'ACTIVE' : startsTrial ? 'TRIAL' : 'PENDING_PAYMENT';
      const trialEndsAt = startsTrial ? new Date(now.getTime() + product.trialDays * DAY_MS) : null;
      const granted = isApp && status !== 'PENDING_PAYMENT' ? product.plugins.map((p) => p.key) : [];
      const fields = {
        status: status as TenantSubscription['status'],
        pricingModel,
        price: product.price != null ? Number(product.price) : null,
        currency: product.currency,
        startDate: now,
        endDate: null,
        currentPeriodStart: isFree ? now : null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        pastDueAt: null,
        pausedAt: null,
        endedAt: null,
        cancelledAt: null,
        subscribedBy: userId,
        ...(isApp ? { grantedPlugins: granted } : {}),
      };
      const subscription = await tenantClient.tenantSubscription.upsert({
        where: { pluginKey: productKey },
        // Keep the old trialEndsAt when no new trial starts — it is the record that the trial was used
        update: { ...fields, trialEndsAt: trialEndsAt ?? existing?.trialEndsAt ?? null },
        create: { pluginKey: productKey, ...fields, trialEndsAt },
      });

      // Subscribing again after a lapsed app (e.g. an expired trial): what it granted before isn't granted now
      const dropped = isApp ? (existing?.grantedPlugins ?? []).filter((key) => !granted.includes(key)) : [];
      if (dropped.length) await this.appPlugins.switchOffUngranted(tenantSlug, dropped);

      let invoiceId: string | null = null;
      let failedPlugins: string[] = [];
      if (status === 'PENDING_PAYMENT') {
        const { invoice, created } = await this.invoices.issueInvoice({
          tenantId,
          tenantSlug,
          pluginKey: productKey,
          kind: pricingModel === 'ONE_TIME' ? 'ONE_TIME' : 'FIRST',
          anchor: now,
          periodStart: null,
          periodEnd: null,
          dueAt: addHours(now, FIRST_INVOICE_DUE_HOURS),
          now,
        });
        invoiceId = invoice.id;
        if (created) this.emitBilling(SystemEvents.BILLING_INVOICE_ISSUED, invoice);
      } else if (isApp) {
        // FREE / TRIAL app: its plugins on now; the subscription stands even if one fails
        failedPlugins = (await this.appPlugins.switchOn(tenantSlug, granted)).map((f) => f.pluginKey);
      } else {
        // FREE / TRIAL plugin: shared toggle core; subscription row must already be ACTIVE/TRIAL
        await this.enablePluginOrRestoreSubscription(tenantSlug, productKey, existing);
      }

      this.pluginEventService.emit<PluginSubscribedPayload>(SystemEvents.PLUGIN_SUBSCRIBED, {
        tenantSlug,
        pluginKey: productKey,
        pluginName: product.name,
        timestamp: now,
      });
      await this.clearCache(tenantSlug, productKey, granted);
      return { subscription, invoiceId, failedPlugins };
    });
  }

  /**
   * A plugin a live app grants can't be bought on its own — unless it was taken out of the app
   * (the subscription keeps it until its next renewal; buying it now avoids a gap).
   */
  private async assertNotGrantedByApp(tenantClient: ReturnType<PrismaService['getTenantClient']>, plugin: Product): Promise<void> {
    const refs = grantingAppRefs(plugin.key, await tenantClient.tenantSubscription.findMany());
    const apps = (await Promise.all(refs.map((ref) => this.catalog.getProduct(ref))))
      .filter((app): app is Product => app !== null && app.plugins.some((p) => p.key === plugin.key));
    if (!apps.length) return;
    const names = apps.map((app) => app.name).sort();
    throw new BadRequestException(`"${plugin.name}" is included in your ${names[0]} app.`);
  }

  /**
   * ACTIVE (recurring) → keeps running until the period end, then ends (undo with
   * resume). Trial / pending payment / past due / paused → ends now, open invoice
   * voided, plugin off. A paid one-time purchase can't be cancelled.
   */
  async cancel(tenantSlug: string, tenantId: string, pluginKey: string, userId?: string): Promise<TenantSubscription> {
    return this.pluginLock.withLock(`toggle:${tenantSlug}:${pluginKey}`, async () => {
      const tenantClient = this.prisma.getTenantClient(tenantSlug);
      const sub = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey } });
      if (!sub) throw new BadRequestException(`No subscription found for "${pluginKey}".`);
      const now = new Date();

      let updated: TenantSubscription;
      if (sub.status === 'ACTIVE' && sub.currentPeriodEnd) {
        updated = await tenantClient.tenantSubscription.update({
          where: { pluginKey },
          data: { cancelAtPeriodEnd: true, cancelledAt: now },
        });
      } else if (sub.status === 'ACTIVE' && sub.pricingModel === 'ONE_TIME') {
        throw new BadRequestException('A one-time purchase can\'t be cancelled.');
      } else if (sub.status === 'ACTIVE' || END_NOW_ON_CANCEL.includes(sub.status)) {
        const isApp = appKeyOf(pluginKey) !== null;
        // A plugin is disabled first: if the core refuses (dependents, failing hook) the subscription stays intact.
        // An app ends first, so it no longer counts as a source; switching its plugins off never throws.
        // ...and a plugin a live app grants stays on
        if (!isApp && !(await this.grantedByApp(tenantSlug, pluginKey))) await this.disablePluginForTenant(tenantSlug, pluginKey);
        await this.voidOpenInvoices(tenantId, pluginKey, now);
        updated = await tenantClient.tenantSubscription.update({
          where: { pluginKey },
          data: { status: 'ENDED', endedAt: now, cancelledAt: now, cancelAtPeriodEnd: false },
        });
        if (isApp) await this.switchOffProduct(tenantSlug, pluginKey);
      } else {
        throw new BadRequestException(`Subscription to "${pluginKey}" is not active.`);
      }

      this.pluginEventService.emit(SystemEvents.PLUGIN_SUBSCRIPTION_CANCELLED, { tenantSlug, pluginKey, userId, timestamp: now });
      await this.clearCache(tenantSlug, pluginKey, sub.grantedPlugins ?? []);
      return updated;
    });
  }

  /** Undo a scheduled cancel before the period ends. */
  async resume(tenantSlug: string, pluginKey: string, now: Date = new Date()): Promise<TenantSubscription> {
    return this.pluginLock.withLock(`toggle:${tenantSlug}:${pluginKey}`, async () => {
      const tenantClient = this.prisma.getTenantClient(tenantSlug);
      const sub = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey } });
      if (!sub || sub.status !== 'ACTIVE' || !sub.cancelAtPeriodEnd || !sub.currentPeriodEnd || now >= sub.currentPeriodEnd) {
        throw new BadRequestException(`There is no scheduled cancellation to undo for "${pluginKey}".`);
      }
      // A voided renewal can't be re-issued for this period: resuming would end in a pause with nothing to pay.
      const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (tenant && (await this.renewalVoided(tenant.id, pluginKey, sub.currentPeriodEnd))) {
        throw new BadRequestException(
          `The renewal of "${pluginKey}" was voided by an administrator, so it can't be resumed. Subscribe again after it ends.`,
        );
      }
      const updated = await tenantClient.tenantSubscription.update({
        where: { pluginKey },
        data: { cancelAtPeriodEnd: false, cancelledAt: null },
      });
      await this.clearCache(tenantSlug, pluginKey);
      return updated;
    });
  }

  /**
   * A verified payment (provider callback or sysadmin Mark paid). Idempotent per
   * invoice. The payment is never rolled back: if switching the plugin on fails,
   * the invoice stays PAID, the subscription ACTIVE, and the error is recorded.
   */
  async activateFromPayment(invoiceId: string, payment: PaymentDetails): Promise<void> {
    const found = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!found) throw new NotFoundException('Invoice not found');

    await this.pluginLock.withLock(`toggle:${found.tenantSlug}:${found.pluginKey}`, async () => {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) return;
      if (invoice.status !== 'OPEN') {
        await this.flagUnexpectedPayment(invoice, payment);
        return;
      }

      const tenantClient = this.prisma.getTenantClient(invoice.tenantSlug);
      const sub = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey: invoice.pluginKey } });
      const isApp = appKeyOf(invoice.pluginKey) !== null;
      // An app grants what it contains now: each paid invoice refreshes the list
      const app = isApp ? await this.catalog.getProduct(invoice.pluginKey) : null;
      const granted = app ? app.plugins.map((p) => p.key) : (sub?.grantedPlugins ?? []);
      const { graceDays } = await this.settings.getSettings();
      const { patch, periodStart, periodEnd } = applyPayment(
        {
          status: sub?.status ?? 'PENDING_PAYMENT',
          trialEndsAt: sub?.trialEndsAt ?? null,
          currentPeriodStart: sub?.currentPeriodStart ?? null,
          currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        },
        { kind: invoice.kind as InvoiceKindName, pricingModel: invoice.pricingModel },
        payment.paidAt,
        graceDays,
      );

      // Claim the invoice: only an OPEN one becomes PAID (a concurrent void or payment wins).
      const { count } = await this.prisma.invoice.updateMany({
        where: { id: invoiceId, status: 'OPEN' },
        data: {
          status: 'PAID',
          paidAt: payment.paidAt,
          paymentProvider: payment.provider,
          paymentMethod: payment.method ?? null,
          paymentReference: payment.reference ?? null,
          complimentary: payment.complimentary,
          periodStart,
          periodEnd,
        },
      });
      if (count === 0) {
        const current = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
        if (current) await this.flagUnexpectedPayment(current, payment);
        return;
      }
      await this.expirePendingCheckouts([invoiceId], new Date());
      const paid = (await this.prisma.invoice.findUnique({ where: { id: invoiceId } })) as Invoice;

      // From here the payment stands: a failure is recorded on the invoice for a sysadmin, never undone.
      try {
        const subData = {
          ...patch,
          endDate: periodEnd,
          price: Number(invoice.subtotal.toString()),
          currency: invoice.currency,
          paymentReference: payment.reference ?? null,
          ...(isApp ? { grantedPlugins: granted } : {}),
        };
        await tenantClient.tenantSubscription.upsert({
          where: { pluginKey: invoice.pluginKey },
          update: subData,
          create: { pluginKey: invoice.pluginKey, startDate: periodStart, ...subData },
        });
        // Switch on only when the plan starts or resumes. While it is running (active, in grace,
        // on trial) the on/off switch is the tenant's: a renewal doesn't override it.
        const wasRunning = sub != null && STILL_RUNNING.includes(sub.status);
        if (isApp) {
          // Add before remove: the app's plugins are on before the subscriptions it replaces end
          const failures = wasRunning ? [] : await this.appPlugins.switchOn(invoice.tenantSlug, granted);
          if (app) await this.replaceOwnSubscriptions({ id: invoice.tenantId, slug: invoice.tenantSlug }, app, payment.paidAt);
          // Plugins taken out of the app leave with this payment, unless something else grants them
          const dropped = (sub?.grantedPlugins ?? []).filter((key) => !granted.includes(key));
          await this.appPlugins.switchOffUngranted(invoice.tenantSlug, dropped);
          if (failures.length) throw new Error(failures.map((f) => `${f.pluginKey}: ${f.error}`).join('; '));
        } else {
          const plugin = await tenantClient.plugin.findUnique({ where: { key: invoice.pluginKey } });
          if (!wasRunning && !plugin?.isEnabled) {
            await this.pluginsService.toggleTenantUnlocked(invoice.tenantSlug, invoice.pluginKey, true);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Invoice ${invoice.number} is paid but "${invoice.pluginKey}" couldn't be activated: ${message}`);
        await this.prisma.invoice.update({ where: { id: invoiceId }, data: { activationError: message } });
        this.emitBilling(SystemEvents.BILLING_ACTIVATION_FAILED, paid);
      }

      await this.clearCache(invoice.tenantSlug, invoice.pluginKey, [...(sub?.grantedPlugins ?? []), ...granted]);
      this.emitBilling(SystemEvents.BILLING_INVOICE_PAID, paid);
    });
  }

  /**
   * A payment for an invoice that is no longer open (paid twice, or paid after a void): flag it for a sysadmin.
   * Settling from credit an invoice already settled from credit (CreditSettlementListener and the job's
   * backstop can both try) moved no money: nothing to flag.
   */
  private async flagUnexpectedPayment(invoice: Invoice, payment: PaymentDetails): Promise<void> {
    if (invoice.status === 'PAID' && invoice.paymentProvider === 'credit' && payment.provider === 'credit') return;
    const code = invoice.status === 'VOID' ? 'paid_after_void' : 'paid_twice';
    this.logger.warn(`Payment for ${invoice.status} invoice ${invoice.number} (${code}) — needs a sysadmin`);
    await this.prisma.invoice.update({ where: { id: invoice.id }, data: { activationError: code } });
  }

  /**
   * Sysadmin Void ("this charge shouldn't exist"): a first / one-time invoice ends
   * the subscription; a renewal or trial-conversion invoice schedules the end at the
   * current period / trial end (or ends it now if that has passed).
   */
  async voidInvoice(invoiceId: string, now: Date = new Date()): Promise<Invoice> {
    const found = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!found) throw new NotFoundException('Invoice not found');

    return this.pluginLock.withLock(`toggle:${found.tenantSlug}:${found.pluginKey}`, async () => {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice || invoice.status !== 'OPEN') {
        throw new BadRequestException('Only open invoices can be voided.');
      }
      const voided = await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID', voidedAt: now } });
      await this.expirePendingCheckouts([invoiceId], now);
      await this.credits.restoreForInvoices([invoiceId]);

      const tenantClient = this.prisma.getTenantClient(invoice.tenantSlug);
      const sub = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey: invoice.pluginKey } });
      if (sub && sub.status !== 'ENDED') {
        const endsAt = sub.status === 'TRIAL' ? sub.trialEndsAt : sub.currentPeriodEnd;
        const scheduleEnd =
          (invoice.kind === 'RENEWAL' || invoice.kind === 'TRIAL_CONVERSION') &&
          (sub.status === 'ACTIVE' || sub.status === 'TRIAL') &&
          endsAt != null &&
          now < endsAt;

        if (scheduleEnd) {
          await tenantClient.tenantSubscription.update({
            where: { pluginKey: invoice.pluginKey },
            data: { cancelAtPeriodEnd: true, cancelledAt: now },
          });
        } else {
          await this.endSubscriptionUnlocked(invoice.tenantSlug, invoice.pluginKey, now);
        }
      }
      await this.clearCache(invoice.tenantSlug, invoice.pluginKey);
      return voided;
    });
  }

  /** Sysadmin Mark paid: a bank transfer made outside the system, or a complimentary period. */
  async markPaid(invoiceId: string, input: { method: 'bank_transfer' | 'complimentary'; reference?: string }): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'OPEN') {
      throw new BadRequestException(`Invoice ${invoice.number} is ${invoice.status.toLowerCase()}.`);
    }
    await this.activateFromPayment(invoiceId, {
      paidAt: new Date(),
      provider: 'manual',
      method: input.method,
      reference: input.reference,
      complimentary: input.method === 'complimentary',
    });
    return (await this.prisma.invoice.findUnique({ where: { id: invoiceId } })) as Invoice;
  }

  /** The tenant's subscriptions with plugin names, open invoices and the next invoice date. */
  async tenantSubscriptions(tenantSlug: string, tenantId: string, now: Date = new Date()): Promise<TenantSubscriptionRow[]> {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const [subs, plugins, apps, open, voidedRenewals, settings, enabledRows] = await Promise.all([
      tenantClient.tenantSubscription.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.plugin.findMany({ select: { key: true, name: true, pricingModel: true } }),
      this.prisma.app.findMany({ select: { key: true, name: true } }),
      this.prisma.invoice.findMany({ where: { tenantId, status: 'OPEN' }, orderBy: { issuedAt: 'desc' } }),
      this.prisma.invoice.findMany({ where: { tenantId, kind: 'RENEWAL', status: 'VOID' }, select: { dedupeKey: true } }),
      this.settings.getSettings(),
      tenantClient.plugin.findMany({ where: { isEnabled: true } }),
    ]);
    const names = new Map([...plugins.map((p): [string, string] => [p.key, p.name]), ...apps.map((a): [string, string] => [appRef(a.key), a.name])]);
    const voided = new Set(voidedRenewals.map((i) => i.dedupeKey));
    const paid = new Set(plugins.filter((p) => p.pricingModel !== 'FREE').map((p) => p.key));
    const enabled = enabledRows.map((p) => p.key);
    // What ending an app would switch off (as switchOffProduct does), in the app's order
    const switchesOff = (s: TenantSubscription): string[] => {
      const granted = s.grantedPlugins ?? [];
      const off = switchOffOrder(granted, subs.filter((o) => o.pluginKey !== s.pluginKey), paid, enabled);
      return [...granted.filter((key) => off.includes(key)), ...off.filter((key) => !granted.includes(key))].map((key) => names.get(key) ?? key);
    };

    return subs.map((s) => {
      const lead = settings.renewalLeadDays;
      let nextInvoiceAt: Date | null = null;
      if (s.status === 'ACTIVE' && s.currentPeriodEnd && !s.cancelAtPeriodEnd) nextInvoiceAt = addDays(s.currentPeriodEnd, -lead);
      if (s.status === 'TRIAL' && s.trialEndsAt && !s.cancelAtPeriodEnd) nextInvoiceAt = addDays(s.trialEndsAt, -lead);
      if (nextInvoiceAt && nextInvoiceAt < now) nextInvoiceAt = null;
      return {
        pluginKey: s.pluginKey,
        pluginName: names.get(s.pluginKey) ?? s.pluginKey,
        kind: appKeyOf(s.pluginKey) !== null ? 'app' : 'plugin',
        includes: appKeyOf(s.pluginKey) !== null ? (s.grantedPlugins ?? []).map((key) => names.get(key) ?? key) : [],
        switchesOff: appKeyOf(s.pluginKey) !== null ? switchesOff(s) : [],
        status: s.status,
        displayStatus: s.status === 'ACTIVE' && s.pricingModel === 'ONE_TIME' && !s.currentPeriodEnd ? 'OWNED' : s.status,
        pricingModel: s.pricingModel,
        price: s.price != null ? s.price.toString() : null,
        currency: s.currency,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        trialEndsAt: s.trialEndsAt,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        resumable:
          s.status === 'ACTIVE' &&
          s.cancelAtPeriodEnd &&
          s.currentPeriodEnd != null &&
          now < new Date(s.currentPeriodEnd) &&
          !voided.has(invoiceDedupeKey(tenantId, s.pluginKey, 'RENEWAL', new Date(s.currentPeriodEnd))),
        nextInvoiceAt,
        openInvoiceId: open.find((i) => i.pluginKey === s.pluginKey)?.id ?? null,
      };
    });
  }

  /**
   * A sysadmin changed a product's pricing (a plugin, or an app `app:<key>`).
   * Model/price/currency changes for paying tenants apply at their next invoice
   * (nothing to do here). Paid → free: open invoices are voided and subscriptions
   * become free and unending (paused/pending ones switched on). Free → paid:
   * tenants already using it get a trial first.
   */
  async applyPricingChange(productKey: string, now: Date = new Date()): Promise<void> {
    const product = await this.catalog.getProduct(productKey);
    if (!product) return;
    const isApp = product.kind === 'app';
    if (product.pricingModel !== 'FREE') {
      // Trials only for tenants using the app now; suspended ones get theirs from the job once reactivated.
      const active = await this.prisma.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { slug: true } });
      for (const tenant of active) {
        if (isApp) await this.grantTrialsForNowPaidApps(tenant.slug, now, product.key);
        else await this.grantTrialsForNowPaidPlugins(tenant.slug, now, product.key);
      }
      return;
    }

    // Made free: every tenant that can come back (not terminated) gets a free, unending plan,
    // so a suspended tenant isn't reactivated into a paused or unpaid plan for a free product.
    const tenants = await this.prisma.tenant.findMany({ where: { status: { not: 'TERMINATED' } }, select: { slug: true } });

    const open = await this.prisma.invoice.findMany({ where: { pluginKey: productKey, status: 'OPEN' }, select: { id: true } });
    if (open.length) {
      const ids = open.map((i) => i.id);
      await this.prisma.invoice.updateMany({ where: { id: { in: ids }, status: 'OPEN' }, data: { status: 'VOID', voidedAt: now } });
      await this.expirePendingCheckouts(ids, now);
      await this.credits.restoreForInvoices(ids);
    }
    const contents = product.plugins.map((p) => p.key);
    for (const tenant of tenants) {
      await this.pluginLock.withLock(`toggle:${tenant.slug}:${productKey}`, async () => {
        const tenantClient = this.prisma.getTenantClient(tenant.slug);
        const sub = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey: productKey } });
        if (!sub || !FREE_CONVERTIBLE.includes(sub.status)) return;

        await tenantClient.tenantSubscription.update({
          where: { pluginKey: productKey },
          data: {
            status: 'ACTIVE',
            pricingModel: 'FREE',
            price: null,
            currentPeriodEnd: null,
            endDate: null,
            cancelAtPeriodEnd: false,
            pastDueAt: null,
            pausedAt: null,
            // A free app grants what it contains now; a live subscription also keeps what it had
            // (a plugin taken out of the app but paid for until the period end), as free ones do
            ...(isApp ? { grantedPlugins: isSubscriptionLive(sub, now) ? [...new Set([...contents, ...(sub.grantedPlugins ?? [])])] : contents } : {}),
          },
        });
        if (sub.status === 'PAUSED' || sub.status === 'PENDING_PAYMENT') {
          if (isApp) {
            await this.appPlugins.switchOn(tenant.slug, contents);
          } else {
            try {
              await this.pluginsService.toggleTenantUnlocked(tenant.slug, productKey, true);
            } catch (error) {
              this.logger.warn(`"${productKey}" is free now but couldn't be switched back on for ${tenant.slug}: ${error instanceof Error ? error.message : error}`);
            }
          }
        }
        await this.clearCache(tenant.slug, productKey, [...(sub.grantedPlugins ?? []), ...contents]);
      });
    }
  }

  /**
   * Tenants holding an app for free that is now paid (no paid subscription) get a trial —
   * the app's trialDays, or 14 — then the normal trial rule applies. Counts as their one trial.
   * Must not be called while holding a toggle lock.
   */
  async grantTrialsForNowPaidApps(tenantSlug: string, now: Date = new Date(), onlyAppKey?: string): Promise<number> {
    const paidApps = await this.prisma.app.findMany({
      where: { pricingModel: { not: 'FREE' }, ...(onlyAppKey ? { key: onlyAppKey } : {}) },
    });
    if (!paidApps.length) return 0;
    const tenantClient = this.prisma.getTenantClient(tenantSlug);

    let granted = 0;
    for (const app of paidApps) {
      const ref = appRef(app.key);
      await this.pluginLock.withLock(`toggle:${tenantSlug}:${ref}`, async () => {
        const sub = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey: ref } });
        if (!sub || sub.pricingModel !== 'FREE' || sub.status !== 'ACTIVE') return;

        await tenantClient.tenantSubscription.update({
          where: { pluginKey: ref },
          data: {
            status: 'TRIAL',
            pricingModel: app.pricingModel,
            price: app.price != null ? Number(app.price) : null,
            currency: app.pricingCurrency,
            trialEndsAt: addDays(now, app.trialDays > 0 ? app.trialDays : FREE_TO_PAID_TRIAL_DAYS),
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          },
        });
        granted++;
      });
    }
    return granted;
  }

  /**
   * Tenants using a paid plugin with no paid subscription (it was free when they
   * turned it on) get a trial — the plugin's trialDays, or 14 — then the normal
   * trial rule applies. Counts as their one trial. Must not be called while holding a toggle lock.
   */
  async grantTrialsForNowPaidPlugins(tenantSlug: string, now: Date = new Date(), onlyPluginKey?: string): Promise<number> {
    const paidPlugins = await this.prisma.plugin.findMany({
      where: { pricingModel: { not: 'FREE' }, ...(onlyPluginKey ? { key: onlyPluginKey } : {}) },
    });
    if (!paidPlugins.length) return 0;
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const enabled = new Set((await tenantClient.plugin.findMany({ where: { isEnabled: true } })).map((p) => p.key));
    // A plugin an app subscription lists (live, or lapsed and about to be paused by the job) is paid for
    // through the app: no trial of its own
    const subs = await tenantClient.tenantSubscription.findMany();
    const listedByApp = (key: string) =>
      subs.some((s) => appKeyOf(s.pluginKey) !== null && s.status !== 'ENDED' && (s.grantedPlugins ?? []).includes(key));

    let granted = 0;
    for (const plugin of paidPlugins.filter((p) => enabled.has(p.key) && !listedByApp(p.key))) {
      await this.pluginLock.withLock(`toggle:${tenantSlug}:${plugin.key}`, async () => {
        const sub = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey: plugin.key } });
        if (sub && sub.pricingModel !== 'FREE') return;

        const fields = {
          status: 'TRIAL' as const,
          pricingModel: plugin.pricingModel,
          price: plugin.price ? Number(plugin.price) : null,
          currency: plugin.pricingCurrency,
          startDate: now,
          endDate: null,
          trialEndsAt: addDays(now, plugin.trialDays > 0 ? plugin.trialDays : FREE_TO_PAID_TRIAL_DAYS),
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          pastDueAt: null,
          pausedAt: null,
          endedAt: null,
        };
        await tenantClient.tenantSubscription.upsert({
          where: { pluginKey: plugin.key },
          update: fields,
          create: { pluginKey: plugin.key, ...fields },
        });
        await this.clearCache(tenantSlug, plugin.key);
        granted++;
      });
    }
    return granted;
  }

  /**
   * A reactivated tenant couldn't pay while suspended: plans that are past due get a
   * fresh grace period from now (the spec's catch-up rule) instead of pausing at once.
   */
  async restartGraceAfterReactivation(tenantSlug: string, now: Date = new Date()): Promise<number> {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const pastDue = await tenantClient.tenantSubscription.findMany({ where: { status: 'PAST_DUE' } });
    let restarted = 0;
    for (const { pluginKey } of pastDue) {
      await this.pluginLock.withLock(`toggle:${tenantSlug}:${pluginKey}`, async () => {
        const sub = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey } });
        if (sub?.status !== 'PAST_DUE') return;
        await tenantClient.tenantSubscription.update({ where: { pluginKey }, data: { pastDueAt: now } });
        restarted++;
      });
    }
    return restarted;
  }

  // --- Internal helpers (callers hold `toggle:${tenantSlug}:${pluginKey}`; PluginLockService is not re-entrant) ---

  /** Whether the renewal for the period ending at `periodEnd` was voided by a sysadmin (same identity the job issues it under). */
  private async renewalVoided(tenantId: string, pluginKey: string, periodEnd: Date): Promise<boolean> {
    const renewal = await this.prisma.invoice.findUnique({
      where: { dedupeKey: invoiceDedupeKey(tenantId, pluginKey, 'RENEWAL', new Date(periodEnd)) },
    });
    return renewal?.status === 'VOID';
  }

  /** ENDED + product off (an app: the plugins nothing else grants). Caller holds the lock. */
  async endSubscriptionUnlocked(tenantSlug: string, pluginKey: string, now: Date): Promise<void> {
    const isApp = appKeyOf(pluginKey) !== null;
    if (!isApp && !(await this.grantedByApp(tenantSlug, pluginKey))) await this.disablePluginForTenant(tenantSlug, pluginKey);
    await this.prisma.getTenantClient(tenantSlug).tenantSubscription.update({
      where: { pluginKey },
      data: { status: 'ENDED', endedAt: now, cancelAtPeriodEnd: false },
    });
    if (isApp) await this.switchOffProduct(tenantSlug, pluginKey);
  }

  /** Whether a live app subscription of the tenant grants the plugin (its own subscription ending then changes nothing). */
  async grantedByApp(tenantSlug: string, pluginKey: string): Promise<boolean> {
    const subs = await this.prisma.getTenantClient(tenantSlug).tenantSubscription.findMany();
    return grantingAppRefs(pluginKey, subs).length > 0;
  }

  /**
   * After a subscription stopped being live: a plugin is disabled (unless a live app grants it); an app's plugins
   * are switched off unless another source grants them (free ones stay on). Call it
   * after the status change, so the subscription no longer counts as a source. Returns the plugins switched off.
   */
  async switchOffProduct(tenantSlug: string, productKey: string): Promise<string[]> {
    if (appKeyOf(productKey) === null) {
      if (await this.grantedByApp(tenantSlug, productKey)) return [];
      return (await this.disablePluginForTenant(tenantSlug, productKey)) ? [productKey] : [];
    }
    const sub = await this.prisma.getTenantClient(tenantSlug).tenantSubscription.findUnique({ where: { pluginKey: productKey } });
    const granted = sub?.grantedPlugins ?? [];
    const switchedOff = await this.appPlugins.switchOffUngranted(tenantSlug, granted);
    await this.appPlugins.clearAccessCache(tenantSlug, granted);
    return switchedOff;
  }

  /** Void a subscription's open invoices (cancel, scheduled end), expire their payment links and give back their credit. */
  async voidOpenInvoices(tenantId: string, pluginKey: string, now: Date): Promise<void> {
    const open = await this.prisma.invoice.findMany({ where: { tenantId, pluginKey, status: 'OPEN' }, select: { id: true } });
    if (!open.length) return;
    const ids = open.map((i) => i.id);
    await this.prisma.invoice.updateMany({ where: { id: { in: ids }, status: 'OPEN' }, data: { status: 'VOID', voidedAt: now } });
    await this.expirePendingCheckouts(ids, now);
    await this.credits.restoreForInvoices(ids);
  }

  private async expirePendingCheckouts(invoiceIds: string[], now: Date): Promise<void> {
    await this.prisma.paymentCheckout.updateMany({
      where: { invoiceId: { in: invoiceIds }, status: 'PENDING' },
      data: { status: 'EXPIRED', completedAt: now },
    });
  }

  /** Forget cached access answers: the plugin's, or for an app those of the plugins it grants (`granted`). */
  private async clearCache(tenantSlug: string, productKey: string, granted: string[] = []): Promise<void> {
    if (appKeyOf(productKey) === null) {
      await this.cache.del(`plugin:tenant:${tenantSlug}:${productKey}`);
      return;
    }
    await this.appPlugins.clearAccessCache(tenantSlug, [...new Set(granted)]);
  }

  /**
   * An app was paid for: the tenant's own subscriptions to its plugins give way
   * (see replacementFor). Ending one never switches the plugin off — the app grants
   * it now. Unused paid time becomes credit. Caller holds the app's lock.
   */
  async replaceOwnSubscriptions(tenant: { id: string; slug: string }, app: Product, now: Date): Promise<void> {
    const tenantClient = this.prisma.getTenantClient(tenant.slug);
    for (const plugin of app.plugins) {
      await this.pluginLock.withLock(`toggle:${tenant.slug}:${plugin.key}`, async () => {
        const own = await tenantClient.tenantSubscription.findUnique({ where: { pluginKey: plugin.key } });
        const action = own ? replacementFor(own, app.currency) : null;
        if (!own || !action || action === 'keep-owned') return;

        let credit: string | null = null;
        if (action === 'stop-renewing') {
          await tenantClient.tenantSubscription.update({ where: { pluginKey: plugin.key }, data: { cancelAtPeriodEnd: true, cancelledAt: now } });
        } else {
          if (action === 'end-with-credit') {
            credit = await this.credits.unusedTime(tenant.id, plugin.key, own.currency, now, own.startDate);
            await this.credits.grant({
              tenantId: tenant.id,
              currency: own.currency,
              amount: credit,
              reason: `Unused time on ${plugin.name} (replaced by ${app.name})`,
              sourceKey: plugin.key,
            });
          }
          await this.voidOpenInvoices(tenant.id, plugin.key, now);
          await tenantClient.tenantSubscription.update({
            where: { pluginKey: plugin.key },
            data: { status: 'ENDED', endedAt: now, cancelledAt: now, cancelAtPeriodEnd: false },
          });
        }
        await this.clearCache(tenant.slug, plugin.key);
        this.pluginEventService.emit<SubscriptionReplacedPayload>(SystemEvents.BILLING_SUBSCRIPTION_REPLACED, {
          tenantSlug: tenant.slug,
          pluginKey: plugin.key,
          pluginName: plugin.name,
          appKey: app.key,
          appName: app.name,
          outcome: action,
          credit,
          currency: own.currency,
          timestamp: now,
        });
      });
    }
  }

  private emitBilling(event: string, invoice: Invoice): void {
    const payload: BillingEventPayload = {
      tenantSlug: invoice.tenantSlug,
      pluginKey: invoice.pluginKey,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      total: invoice.total.toString(),
      currency: invoice.currency,
      timestamp: new Date(),
    };
    this.pluginEventService.emit(event, payload);
  }

  /**
   * Enable via the shared toggle core (subscription check, dependencies, lifecycle hooks, default config,
   * permissions, cache, events). If that fails, put the subscription AND the plugin's enabled flag back
   * the way they were. Used for FREE and TRIAL subscribes only — never after a payment.
   */
  private async enablePluginOrRestoreSubscription(
    tenantSlug: string,
    pluginKey: string,
    previous: TenantSubscription | null,
  ) {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const wasEnabled = (await tenantClient.plugin.findUnique({ where: { key: pluginKey } }))?.isEnabled ?? false;

    try {
      await this.pluginsService.toggleTenantUnlocked(tenantSlug, pluginKey, true);
    } catch (error) {
      // The core may fail after writing isEnabled=true (e.g. while seeding permissions)
      if (!wasEnabled) {
        await tenantClient.plugin.updateMany({ where: { key: pluginKey }, data: { isEnabled: false } });
        await this.clearCache(tenantSlug, pluginKey);
      }
      if (previous) {
        const { id, createdAt, updatedAt, ...restore } = previous;
        await tenantClient.tenantSubscription.update({ where: { pluginKey }, data: restore });
      } else {
        await tenantClient.tenantSubscription.delete({ where: { pluginKey } });
      }
      throw error;
    }
  }

  /** Disable via the shared toggle core — only if the plugin is currently enabled for the tenant. True when it was switched off. */
  async disablePluginForTenant(tenantSlug: string, pluginKey: string): Promise<boolean> {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const tenantPlugin = await tenantClient.plugin.findUnique({ where: { key: pluginKey } });
    if (!tenantPlugin?.isEnabled) return false;

    await this.pluginsService.toggleTenantUnlocked(tenantSlug, pluginKey, false);
    return true;
  }
}
