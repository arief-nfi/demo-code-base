import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import type { Invoice, InvoiceKind } from '@saas/database';
import { BillingSettingsService } from './billing-settings.service';
import { CatalogService } from './catalog.service';
import { CreditService } from './credit.service';
import { computeInvoiceAmounts, formatAmount, isZero } from './money';

export interface IssueInvoiceInput {
  tenantId: string;
  tenantSlug: string;
  /** Product key: a plugin key, or `app:<appKey>` for an app. */
  pluginKey: string;
  kind: InvoiceKind;
  /** What makes this charge unique for the product: subscribe time, period start, trial end. */
  anchor: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueAt: Date;
  now?: Date;
}

export interface AdminInvoiceQuery {
  status?: 'OPEN' | 'PAID' | 'VOID' | 'OVERDUE';
  tenant?: string;
  plugin?: string;
  page: number;
  limit: number;
}

export interface AdminInvoicePage {
  data: Invoice[];
  meta: { total: number; page: number; limit: number };
}

export interface AdminSummary {
  paidThisMonth: { currency: string; amount: string }[];
  outstanding: { currency: string; amount: string }[];
  overdueTenants: number;
  activationFailures: number;
  disabledPaidPlugins: string[];
}

/** What makes a charge unique: a tenant's plugin, the kind of charge, and its anchor (subscribe time, period end, trial end). */
export function invoiceDedupeKey(tenantId: string, pluginKey: string, kind: InvoiceKind, anchor: Date): string {
  return `${tenantId}:${pluginKey}:${kind}:${anchor.toISOString()}`;
}

function isUniqueViolation(error: unknown, field: string): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  return e?.code === 'P2002' && String(e.meta?.target ?? '').includes(field);
}

/**
 * Invoices (public schema): one per product (plugin or app) per charge, numbered
 * INV-<YYYY>-<NNNN>. The tenant's credit in the invoice currency comes off when it is issued.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: BillingSettingsService,
    private readonly catalog: CatalogService,
    private readonly credits: CreditService,
  ) {}

  /**
   * Create the invoice for one charge, or return the one already issued for it
   * (same tenant + plugin + kind + anchor) — whatever its status, VOID included,
   * so re-running the billing job never bills a charge twice.
   */
  async issueInvoice(input: IssueInvoiceInput): Promise<{ invoice: Invoice; created: boolean }> {
    const dedupeKey = invoiceDedupeKey(input.tenantId, input.pluginKey, input.kind, input.anchor);
    const existing = await this.prisma.invoice.findUnique({ where: { dedupeKey } });
    if (existing) return { invoice: existing, created: false };

    const product = await this.catalog.getProduct(input.pluginKey);
    if (!product) {
      throw new BadRequestException(`"${input.pluginKey}" not found.`);
    }
    const price = product.price;
    if (product.pricingModel === 'FREE' || price == null) {
      throw new BadRequestException(`"${input.pluginKey}" has no price to invoice.`);
    }

    const settings = await this.settings.getSettings();
    const profile = await this.settings.getProfile(input.tenantId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId } });
    const tax = { enabled: settings.taxEnabled, name: settings.taxName, rate: settings.taxRate };
    const currency = product.currency;
    const now = input.now ?? new Date();
    const year = now.getUTCFullYear();

    try {
      const invoice = await this.prisma.$transaction(async (tx) => {
        // Credit is taken under a per-tenant-and-currency lock, so two invoices can't both use it
        const available = await this.credits.lockAndBalance(tx, input.tenantId, currency);
        const amounts = computeInvoiceAmounts(price, currency, tax, available.startsWith('-') ? '0' : available);
        const counter = await tx.invoiceCounter.upsert({
          where: { year },
          create: { year, last: 1 },
          update: { last: { increment: 1 } },
        });
        const created = await tx.invoice.create({
          data: {
            number: `INV-${year}-${String(counter.last).padStart(4, '0')}`,
            dedupeKey,
            tenantId: input.tenantId,
            tenantSlug: input.tenantSlug,
            pluginKey: product.ref,
            pluginName: product.name,
            kind: input.kind,
            pricingModel: product.pricingModel,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            currency,
            subtotal: amounts.subtotal,
            taxName: amounts.taxName,
            taxRate: amounts.taxRate,
            taxAmount: amounts.taxAmount,
            creditAmount: amounts.creditAmount,
            total: amounts.total,
            includes: product.kind === 'app' ? product.plugins.map(({ key, name }) => ({ key, name })) : undefined,
            issuedAt: now,
            dueAt: input.dueAt,
            sellerSnapshot: {
              name: settings.sellerName,
              address: settings.sellerAddress,
              taxId: settings.sellerTaxId,
              email: settings.sellerEmail,
            },
            billToSnapshot: {
              name: profile.companyName ?? tenant?.name ?? input.tenantSlug,
              email: profile.billingEmail,
              address: profile.address,
              taxId: profile.taxId,
            },
          },
        });
        if (!isZero(amounts.creditAmount, currency)) {
          await this.credits.recordUse(tx, { tenantId: input.tenantId, currency, amount: amounts.creditAmount, invoiceId: created.id });
        }
        return created;
      });
      return { invoice, created: true };
    } catch (error) {
      // Lost a race with a concurrent issue of the same charge: theirs wins.
      if (isUniqueViolation(error, 'dedupeKey')) {
        const winner = await this.prisma.invoice.findUnique({ where: { dedupeKey } });
        if (winner) return { invoice: winner, created: false };
      }
      throw error;
    }
  }

  async getForTenant(tenantId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async getAdmin(invoiceId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  listForTenant(tenantId: string): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({ where: { tenantId }, orderBy: { issuedAt: 'desc' } });
  }

  findOpenForSubscription(tenantId: string, pluginKey: string): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({
      where: { tenantId, pluginKey, status: 'OPEN' },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async listAdmin(q: AdminInvoiceQuery, now: Date = new Date()): Promise<AdminInvoicePage> {
    const where: Record<string, unknown> = {};
    if (q.status === 'OVERDUE') {
      where.status = 'OPEN';
      where.dueAt = { lt: now };
    } else if (q.status) {
      where.status = q.status;
    }
    if (q.tenant) where.tenantSlug = q.tenant;
    if (q.plugin) where.pluginKey = q.plugin;

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { data, meta: { total, page: q.page, limit: q.limit } };
  }

  async adminSummary(now: Date): Promise<AdminSummary> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [paid, open, overdue, activationFailures, disabled] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['currency'],
        where: { status: 'PAID', complimentary: false, paidAt: { gte: monthStart, lt: nextMonth } },
        _sum: { total: true },
      }),
      this.prisma.invoice.groupBy({ by: ['currency'], where: { status: 'OPEN' }, _sum: { total: true } }),
      this.prisma.invoice.findMany({
        where: { status: 'OPEN', dueAt: { lt: now } },
        distinct: ['tenantId'],
        select: { tenantId: true },
      }),
      this.prisma.invoice.count({ where: { activationError: { not: null } } }),
      this.prisma.plugin.findMany({
        where: { isEnabled: false, pricingModel: { not: 'FREE' } },
        select: { key: true },
        orderBy: { key: 'asc' },
      }),
    ]);

    const toAmounts = (groups: { currency: string; _sum: { total: { toString(): string } | null } }[]) =>
      groups.map((g) => ({ currency: g.currency, amount: formatAmount(g._sum.total ?? '0', g.currency) }));

    return {
      paidThisMonth: toAmounts(paid),
      outstanding: toAmounts(open),
      overdueTenants: overdue.length,
      activationFailures,
      disabledPaidPlugins: disabled.map((p) => p.key),
    };
  }
}
