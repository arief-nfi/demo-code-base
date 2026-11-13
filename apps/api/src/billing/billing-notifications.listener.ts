import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_SERVICE, OnEvent, PrismaService, SystemEvents, WebSocketBridgeService, appKeyOf } from '@saas/backend';
import type { BillingEventPayload, IEmailService, SubscriptionReplacedPayload } from '@saas/backend';
import { NotificationService } from '../notifications/notification.service';
import { BillingRecipientsService } from './billing-recipients.service';
import { BillingSettingsService } from './billing-settings.service';
import { displayMoney, isZero } from './money';

type NoticeType = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

interface Notice {
  title: string;
  body: string;
  type: NoticeType;
  /** The email to send (a core.billing-* definition); absent → no email. */
  email?: { template: string; data: Record<string, unknown> };
}

const dateText = (d: Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** In-app notifications for tenant admins and emails to the billing contact. Never throws. */
@Injectable()
export class BillingNotificationsListener {
  private readonly logger = new Logger(BillingNotificationsListener.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
    private readonly recipients: BillingRecipientsService,
    private readonly prisma: PrismaService,
    private readonly settings: BillingSettingsService,
    private readonly wsBridge: WebSocketBridgeService,
  ) {}

  @OnEvent(SystemEvents.BILLING_INVOICE_ISSUED)
  onInvoiceIssued(payload: BillingEventPayload): Promise<void> {
    // Nothing to pay: the tenant's credit covers it and it is settled at once (onInvoicePaid tells them)
    return this.send(SystemEvents.BILLING_INVOICE_ISSUED, payload, async (i) => i.nothingToPay ? null : {
      title: 'New invoice',
      body: `Invoice ${i.number} for "${i.pluginName}": ${i.amount}, due ${i.due}.`,
      type: 'INFO',
      email: { template: 'core.billing-invoice-issued', data: { pluginName: i.pluginName, number: i.number, amount: i.amount, due: i.due, billingUrl: i.billingUrl } },
    });
  }

  @OnEvent(SystemEvents.BILLING_INVOICE_PAID)
  onInvoicePaid(payload: BillingEventPayload): Promise<void> {
    return this.send(SystemEvents.BILLING_INVOICE_PAID, payload, async (i) => i.complimentary ? {
      // Mark paid as complimentary: nothing was paid, so no receipt
      title: i.isApp ? 'App activated' : 'Plugin activated',
      body: `"${i.pluginName}" is active at no charge (complimentary).`,
      type: 'SUCCESS',
      email: { template: 'core.billing-complimentary', data: { pluginName: i.pluginName, number: i.number, billingUrl: i.billingUrl } },
    } : i.paidWithCredit ? {
      title: 'Paid from your credit',
      body: `Invoice ${i.number} for "${i.pluginName}" was paid from your credit (${i.credit}).`,
      type: 'SUCCESS',
      email: { template: 'core.billing-paid-with-credit', data: { pluginName: i.pluginName, number: i.number, credit: i.credit, billingUrl: i.billingUrl } },
    } : {
      title: 'Payment received',
      body: `Invoice ${i.number} for "${i.pluginName}" is paid. Thank you!`,
      type: 'SUCCESS',
      email: { template: 'core.billing-invoice-paid', data: { pluginName: i.pluginName, number: i.number, amount: i.amount, billingUrl: i.billingUrl } },
    });
  }

  @OnEvent(SystemEvents.BILLING_SUBSCRIPTION_PAST_DUE)
  onPastDue(payload: BillingEventPayload): Promise<void> {
    return this.send(SystemEvents.BILLING_SUBSCRIPTION_PAST_DUE, payload, async (i) => {
      const { graceDays } = await this.settings.getSettings();
      return {
        title: 'Payment overdue',
        body: `"${i.pluginName}" is unpaid (invoice ${i.number}). Pay within ${graceDays} days to keep it.`,
        type: 'WARNING',
        email: { template: 'core.billing-past-due', data: { pluginName: i.pluginName, isApp: i.isApp, number: i.number, amount: i.amount, graceDays, billingUrl: i.billingUrl } },
      };
    });
  }

  @OnEvent(SystemEvents.BILLING_SUBSCRIPTION_PAUSED)
  onPaused(payload: BillingEventPayload): Promise<void> {
    return this.send(SystemEvents.BILLING_SUBSCRIPTION_PAUSED, payload, async (i) => {
      // An app names the plugins it switched off (when the job said which)
      const off = payload.switchedOff ? await this.pluginNames(payload.switchedOff) : null;
      const next = !i.isApp
        ? 'Pay it to switch the plugin back on.'
        : off === null
          ? 'Pay it to switch its plugins back on.'
          : off.length
            ? `Pay it to switch ${off.join(', ')} back on.`
            : 'Its plugins stay on because you have them another way.';
      return {
        title: i.isApp ? 'App paused' : 'Plugin paused',
        body: `"${i.pluginName}" is paused because invoice ${i.number} is unpaid. ${next}`,
        type: 'ERROR',
        email: {
          template: 'core.billing-paused',
          data: { pluginName: i.pluginName, isApp: i.isApp, switchedOff: off?.join(', ') ?? '', number: i.number, amount: i.amount, billingUrl: i.billingUrl },
        },
      };
    });
  }

  @OnEvent(SystemEvents.BILLING_ACTIVATION_FAILED)
  onActivationFailed(payload: BillingEventPayload): Promise<void> {
    return this.send(SystemEvents.BILLING_ACTIVATION_FAILED, payload, async (i) => ({
      title: "Paid — plugin couldn't be switched on",
      body: i.isApp
        ? `Invoice ${i.number} is paid, but some of "${i.pluginName}"'s plugins couldn't be switched on. Try enabling them from Tenant Plugins.`
        : `Invoice ${i.number} is paid, but "${i.pluginName}" couldn't be switched on. Try enabling it from Tenant Plugins.`,
      type: 'WARNING',
    }));
  }

  /** An app the tenant paid for took over one of its own plugin subscriptions (in-app only). */
  @OnEvent(SystemEvents.BILLING_SUBSCRIPTION_REPLACED)
  async onReplaced(payload: SubscriptionReplacedPayload): Promise<void> {
    const included = `"${payload.pluginName}" is now included in ${payload.appName}.`;
    const body =
      payload.outcome === 'stop-renewing'
        ? `${included} Its own subscription won't renew.`
        : payload.outcome === 'end'
          ? `${included} Its own subscription has ended.`
          : payload.credit && !isZero(payload.credit, payload.currency)
            ? `${included} ${displayMoney(payload.credit, payload.currency)} for its unused time was added to your credit.`
            : included;
    try {
      await this.notifications.notifyAdmins(payload.tenantSlug, {
        title: `Now part of ${payload.appName}`,
        body,
        type: 'INFO',
        category: 'billing',
        link: '/billing',
        sourceEvent: SystemEvents.BILLING_SUBSCRIPTION_REPLACED,
      });
      this.broadcast(payload.tenantSlug);
    } catch (error) {
      this.logger.warn(`Billing notice for ${SystemEvents.BILLING_SUBSCRIPTION_REPLACED} (${payload.tenantSlug}/${payload.pluginKey}) failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Plugin names in the given order (the key when a plugin is unknown). */
  private async pluginNames(pluginKeys: string[]): Promise<string[]> {
    if (!pluginKeys.length) return [];
    const rows = await this.prisma.plugin.findMany({ where: { key: { in: pluginKeys } }, select: { key: true, name: true } });
    return pluginKeys.map((key) => rows.find((p) => p.key === key)?.name ?? key);
  }

  private broadcast(tenantSlug: string): void {
    try {
      this.wsBridge.broadcastToTenant(tenantSlug, 'notification:new', { timestamp: new Date() });
    } catch {
      // WebSocket may not be connected — non-critical
    }
  }

  /** `build` returns null when there is nothing to tell. */
  private async send(
    event: string,
    payload: BillingEventPayload,
    build: (i: {
      number: string;
      pluginName: string;
      isApp: boolean;
      amount: string;
      due: string;
      complimentary: boolean;
      /** The total is zero: credit covered it all. */
      nothingToPay: boolean;
      /** Settled from the tenant's credit (provider `credit`). */
      paidWithCredit: boolean;
      /** The credit taken off the invoice, formatted. */
      credit: string;
      billingUrl: string;
    }) => Promise<Notice | null>,
  ): Promise<void> {
    try {
      const invoice = payload.invoiceId ? await this.prisma.invoice.findUnique({ where: { id: payload.invoiceId } }) : null;
      const notice = await build({
        number: invoice?.number ?? payload.invoiceNumber ?? '',
        pluginName: invoice?.pluginName ?? payload.pluginKey,
        isApp: appKeyOf(invoice?.pluginKey ?? payload.pluginKey) !== null,
        amount: invoice ? displayMoney(invoice.total, invoice.currency) : payload.total && payload.currency ? displayMoney(payload.total, payload.currency) : '',
        due: invoice ? dateText(invoice.dueAt) : '',
        complimentary: invoice?.complimentary ?? false,
        nothingToPay: invoice ? isZero(invoice.total, invoice.currency) : false,
        paidWithCredit: invoice?.paymentProvider === 'credit',
        credit: invoice ? displayMoney(invoice.creditAmount ?? '0', invoice.currency) : '',
        billingUrl: `${process.env.FRONTEND_URL}/billing`,
      });
      if (!notice) return;

      await this.notifications.notifyAdmins(payload.tenantSlug, {
        title: notice.title,
        body: notice.body,
        type: notice.type,
        category: 'billing',
        link: '/billing',
        sourceEvent: event,
      });
      this.broadcast(payload.tenantSlug);

      if (notice.email) {
        const to = await this.recipients.emailsFor(payload.tenantSlug);
        await this.email.send({
          template: notice.email.template,
          tenantSlug: payload.tenantSlug,
          to,
          // One email per event and invoice, even if the event is delivered twice
          ...(payload.invoiceId ? { idempotencyKey: `${event}:${payload.invoiceId}` } : {}),
          data: notice.email.data,
        });
      }
    } catch (error) {
      this.logger.warn(`Billing notice for ${event} (${payload.tenantSlug}/${payload.pluginKey}) failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
