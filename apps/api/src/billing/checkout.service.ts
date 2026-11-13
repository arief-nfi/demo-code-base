import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@saas/backend';
import { BillingSettingsService } from './billing-settings.service';
import { formatAmount, isZero } from './money';
import { addHours } from './periods';
import { FakePaymentProvider } from './providers/fake.provider';
import {
  BILLING_PROVIDER,
  PAYMENT_ACTIVATOR,
  type CallbackHeaders,
  type PaymentActivator,
  type PaymentProvider,
} from './providers/payment-provider';

export const PAID_PLUGINS_UNAVAILABLE = "Paid plugins aren't available yet";

export interface FakeCheckoutView {
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  expiresAt: Date;
  invoice: {
    number: string;
    status: string;
    tenantName: string;
    pluginName: string;
    periodStart: Date | null;
    periodEnd: Date | null;
    currency: string;
    total: string;
    dueAt: Date;
  };
}

/** Payment links for invoices and the provider callbacks that settle them. */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly provider: PaymentProvider | null,
    @Inject(PAYMENT_ACTIVATOR) private readonly activator: PaymentActivator,
    private readonly settings: BillingSettingsService,
  ) {}

  isAvailable(): boolean {
    return this.provider !== null;
  }

  get providerKey(): PaymentProvider['key'] | null {
    return this.provider?.key ?? null;
  }

  /** A payment link for one of the tenant's open invoices (an unexpired one is reused). */
  async createCheckout(tenantId: string, invoiceId: string, now: Date = new Date()): Promise<{ checkoutUrl: string }> {
    if (!this.provider) {
      throw new ServiceUnavailableException(PAID_PLUGINS_UNAVAILABLE);
    }
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'OPEN') {
      throw new BadRequestException(`Invoice ${invoice.number} is ${invoice.status.toLowerCase()} and can't be paid.`);
    }
    if (isZero(invoice.total, invoice.currency)) {
      throw new BadRequestException('This invoice is covered by your credit and is settled automatically.');
    }

    const reusable = await this.prisma.paymentCheckout.findFirst({
      where: { invoiceId, provider: this.provider.key, status: 'PENDING', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable) return { checkoutUrl: reusable.url };

    const { checkoutValidHours } = await this.settings.getSettings();
    const checkoutId = randomUUID();
    const expiresAt = addHours(now, checkoutValidHours);
    const { externalId, url } = await this.provider.createCheckout({ checkoutId, invoice, expiresAt });
    await this.prisma.paymentCheckout.create({
      data: { id: checkoutId, invoiceId, provider: this.provider.key, externalId, url, expiresAt, createdAt: now },
    });
    return { checkoutUrl: url };
  }

  /**
   * Settle a provider callback. Idempotent: a checkout is claimed as PAID once
   * (atomically); repeats are no-ops. The amount must match the invoice total.
   * A payment after the link was marked expired still counts — the money moved.
   */
  async handleCallback(providerKey: string, headers: CallbackHeaders, body: unknown): Promise<{ handled: boolean }> {
    if (!this.provider || this.provider.key !== providerKey) {
      throw new NotFoundException();
    }
    const callback = this.provider.parseCallback(headers, body);
    const checkout = await this.prisma.paymentCheckout.findUnique({ where: { externalId: callback.externalId } });
    if (!checkout) throw new NotFoundException('Unknown checkout');
    const invoice = await this.prisma.invoice.findUnique({ where: { id: checkout.invoiceId } });
    if (!invoice) throw new NotFoundException('Unknown invoice');
    const now = new Date();

    if (callback.status !== 'PAID') {
      const { count } = await this.prisma.paymentCheckout.updateMany({
        where: { id: checkout.id, status: 'PENDING' },
        data: { status: callback.status, completedAt: now },
      });
      return { handled: count > 0 };
    }

    if (formatAmount(callback.amount, invoice.currency) !== formatAmount(invoice.total, invoice.currency)) {
      this.logger.error(
        `Callback amount ${callback.amount} != invoice ${invoice.number} total ${invoice.total} (${invoice.currency}); ignored`,
      );
      throw new BadRequestException('Amount does not match the invoice');
    }

    const { count } = await this.prisma.paymentCheckout.updateMany({
      where: { id: checkout.id, status: { not: 'PAID' } },
      data: { status: 'PAID', completedAt: now },
    });
    if (count === 0) return { handled: false };

    if (invoice.status === 'VOID') {
      this.logger.warn(`Payment received for VOID invoice ${invoice.number} (checkout ${checkout.id}) — needs a sysadmin`);
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { activationError: 'paid_after_void' } });
      return { handled: true };
    }

    try {
      await this.activator.activateFromPayment(invoice.id, {
        paidAt: callback.paidAt ?? now,
        provider: this.provider.key,
        method: callback.method,
        reference: callback.reference,
        complimentary: false,
      });
    } catch (error) {
      // Nothing was recorded (activation records its own failures once the invoice is paid):
      // release the claim so the provider's retry of this callback is processed, not ignored.
      await this.prisma.paymentCheckout.updateMany({
        where: { id: checkout.id, status: 'PAID' },
        data: { status: checkout.status, completedAt: checkout.completedAt },
      });
      throw error;
    }
    return { handled: true };
  }

  /** Data for the fake payment page. 404 unless the fake provider is active. */
  async getFakeCheckout(checkoutId: string, now: Date = new Date()): Promise<FakeCheckoutView> {
    const { checkout, invoice } = await this.loadFakeCheckout(checkoutId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: invoice.tenantId } });
    const status = checkout.status === 'PENDING' && checkout.expiresAt <= now ? 'EXPIRED' : checkout.status;
    return {
      status,
      expiresAt: checkout.expiresAt,
      invoice: {
        number: invoice.number,
        status: invoice.status,
        tenantName: tenant?.name ?? invoice.tenantSlug,
        pluginName: invoice.pluginName,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        currency: invoice.currency,
        total: formatAmount(invoice.total, invoice.currency),
        dueAt: invoice.dueAt,
      },
    };
  }

  /** The fake page's buttons: send ourselves the callback a real provider would, through handleCallback. */
  async simulateFake(checkoutId: string, outcome: 'PAID' | 'FAILED' | 'EXPIRED', now: Date = new Date()): Promise<{ redirectUrl: string }> {
    const { checkout, invoice, provider } = await this.loadFakeCheckout(checkoutId);
    if (checkout.status !== 'PENDING') {
      throw new BadRequestException(`This payment link is already ${checkout.status.toLowerCase()}.`);
    }
    if (checkout.expiresAt <= now) {
      throw new BadRequestException('This payment link has expired.');
    }

    const { headers, body } = provider.buildCallback({
      externalId: checkout.externalId,
      amount: formatAmount(invoice.total, invoice.currency),
      outcome,
      at: now,
    });
    await this.handleCallback('fake', headers, body);

    const number = encodeURIComponent(invoice.number);
    return { redirectUrl: outcome === 'PAID' ? `/billing?paid=${number}` : `/billing?payment=failed&invoice=${number}` };
  }

  /** Mark links past their expiry as EXPIRED (billing job). */
  async expireStale(now: Date): Promise<number> {
    const { count } = await this.prisma.paymentCheckout.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      data: { status: 'EXPIRED', completedAt: now },
    });
    return count;
  }

  private async loadFakeCheckout(checkoutId: string) {
    const provider = this.provider;
    if (!(provider instanceof FakePaymentProvider)) throw new NotFoundException();
    const checkout = await this.prisma.paymentCheckout.findUnique({ where: { id: checkoutId } });
    if (!checkout || checkout.provider !== 'fake') throw new NotFoundException('Payment link not found');
    const invoice = await this.prisma.invoice.findUnique({ where: { id: checkout.invoiceId } });
    if (!invoice) throw new NotFoundException('Payment link not found');
    return { checkout, invoice, provider };
  }
}
