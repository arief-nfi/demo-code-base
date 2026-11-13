import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, PrismaService, SystemEvents } from '@saas/backend';
import type { BillingEventPayload } from '@saas/backend';
import { isZero } from './money';
import { SubscriptionsService } from './subscriptions.service';

/**
 * An invoice fully covered by the tenant's credit has nothing to pay: settle it
 * as paid with provider `credit`. Runs as an event listener on purpose — the
 * issuer holds the product's lock, which activateFromPayment takes too, and the
 * emitter doesn't wait for listeners, so this runs once that lock is released.
 */
@Injectable()
export class CreditSettlementListener {
  private readonly logger = new Logger(CreditSettlementListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @OnEvent(SystemEvents.BILLING_INVOICE_ISSUED)
  async onIssued(payload: BillingEventPayload): Promise<void> {
    if (!payload.invoiceId) return;
    try {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: payload.invoiceId } });
      if (!invoice || invoice.status !== 'OPEN' || !isZero(invoice.total, invoice.currency)) return;
      await this.subscriptions.activateFromPayment(invoice.id, {
        paidAt: new Date(),
        provider: 'credit',
        method: 'credit',
        complimentary: false,
      });
    } catch (error) {
      this.logger.error(`Settling credited invoice ${payload.invoiceId} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
