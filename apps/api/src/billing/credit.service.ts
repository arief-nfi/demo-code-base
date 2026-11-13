import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import type { Prisma } from '@saas/database';
import { unusedValue } from './credit';
import { isZero, signedSum } from './money';

type Tx = Prisma.TransactionClient;

/**
 * A tenant's credit (public schema), kept as entries per currency: GRANT (unused time
 * of a replaced subscription), USE (taken off an invoice), RESTORE (that invoice was
 * voided). The balance is their sum; invoices take it when they are issued.
 */
@Injectable()
export class CreditService {
  constructor(private readonly prisma: PrismaService) {}

  async balance(tenantId: string, currency: string, tx?: Tx): Promise<string> {
    const entries = await (tx ?? this.prisma).billingCredit.findMany({ where: { tenantId, currency } });
    return signedSum(entries.map((e) => e.amount), currency);
  }

  /** Non-zero balances, one per currency. */
  async balances(tenantId: string): Promise<Array<{ currency: string; amount: string }>> {
    const entries = await this.prisma.billingCredit.findMany({ where: { tenantId } });
    const currencies = [...new Set(entries.map((e) => e.currency))].sort();
    return currencies
      .map((currency) => ({ currency, amount: signedSum(entries.filter((e) => e.currency === currency).map((e) => e.amount), currency) }))
      .filter((b) => !b.amount.startsWith('-') && !isZero(b.amount, b.currency));
  }

  async grant(input: { tenantId: string; currency: string; amount: string; reason: string; sourceKey: string }): Promise<void> {
    if (isZero(input.amount, input.currency)) return;
    await this.prisma.billingCredit.create({
      data: { tenantId: input.tenantId, currency: input.currency, kind: 'GRANT', amount: input.amount, reason: input.reason, sourceKey: input.sourceKey },
    });
  }

  /** Serialise credit use per tenant and currency for the rest of the transaction, then read the balance. */
  async lockAndBalance(tx: Tx, tenantId: string, currency: string): Promise<string> {
    const key = `billing-credit:${tenantId}:${currency}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return this.balance(tenantId, currency, tx);
  }

  async recordUse(tx: Tx, input: { tenantId: string; currency: string; amount: string; invoiceId: string }): Promise<void> {
    await tx.billingCredit.create({
      data: { tenantId: input.tenantId, currency: input.currency, kind: 'USE', amount: `-${input.amount}`, reason: 'Taken off an invoice', invoiceId: input.invoiceId },
    });
  }

  /**
   * What the paid time still ahead of a tenant's plugin (or app) subscription is worth at `now` —
   * its credit when replaced. Only periods starting at or after `since` (the subscription's start)
   * count: time paid under an earlier subscription was already credited or ended with it.
   */
  async unusedTime(tenantId: string, productKey: string, currency: string, now: Date, since?: Date | null): Promise<string> {
    const paid = await this.prisma.invoice.findMany({
      where: { tenantId, pluginKey: productKey, status: 'PAID', periodEnd: { gt: now } },
    });
    return unusedValue(
      paid
        .filter((i) => i.periodStart && i.periodEnd && (!since || new Date(i.periodStart) >= new Date(since)))
        .map((i) => ({ subtotal: i.subtotal.toString(), periodStart: i.periodStart!, periodEnd: i.periodEnd!, complimentary: i.complimentary })),
      currency,
      now,
    );
  }

  /**
   * Voided invoices give back the credit they used — once per invoice. An invoice that isn't VOID
   * (paid between the caller reading it and voiding it) keeps its credit.
   */
  async restoreForInvoices(invoiceIds: string[]): Promise<void> {
    for (const invoiceId of invoiceIds) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (invoice?.status !== 'VOID') continue;
      const entries = await this.prisma.billingCredit.findMany({ where: { invoiceId } });
      const uses = entries.filter((e) => e.kind === 'USE');
      if (!uses.length || entries.some((e) => e.kind === 'RESTORE')) continue;
      const { tenantId, currency } = uses[0];
      const used = signedSum(uses.map((e) => e.amount), currency);
      await this.prisma.billingCredit.create({
        data: { tenantId, currency, kind: 'RESTORE', amount: used.replace(/^-/, ''), reason: 'Invoice voided', invoiceId },
      });
    }
  }
}
