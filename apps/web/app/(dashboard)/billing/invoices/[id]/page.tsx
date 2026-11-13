'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { forbidden, useParams } from 'next/navigation';
import { ChevronLeft, Printer } from 'lucide-react';
import {
  apiClient, ApiRequestError, Button, ErrorAlert, ListPageSkeleton, PageContainer, cn, formatDate, formatMoney,
  useLanguage, useRBAC,
} from '@saas/ui';

interface Party {
  name: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
}

interface Invoice {
  id: string;
  number: string;
  pluginName: string;
  kind: string;
  pricingModel: string;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  subtotal: string;
  taxName: string | null;
  taxRate: string | null;
  taxAmount: string;
  /** Credit taken off before tax. */
  creditAmount: string;
  total: string;
  /** App invoices: the plugins it included. */
  includes: Array<{ key: string; name: string }> | null;
  status: 'OPEN' | 'PAID' | 'VOID';
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  complimentary: boolean;
  sellerSnapshot: Party;
  billToSnapshot: Party;
}

const STAMP: Record<Invoice['status'], string> = {
  PAID: 'border-green-600 text-green-600',
  OPEN: 'border-amber-500 text-amber-600',
  VOID: 'border-muted-foreground text-muted-foreground',
};

function PartyBlock({ label, taxLabel, party }: { label: string; taxLabel: string; party: Party }) {
  return (
    <div className="text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {party.name && <div className="font-semibold">{party.name}</div>}
      {party.address && <div className="whitespace-pre-line">{party.address}</div>}
      {party.email && <div>{party.email}</div>}
      {party.taxId && <div>{taxLabel}: {party.taxId}</div>}
    </div>
  );
}

/** A printable invoice: the browser's "Save as PDF" is the PDF. */
export default function InvoicePage() {
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const { authorize, hasRole, isLoading: isRBACLoading } = useRBAC();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSysadmin = hasRole('SYSADMIN');

  useEffect(() => {
    if (isRBACLoading) return;
    const url = isSysadmin ? `/billing/admin/invoices/${id}` : `/billing/invoices/${id}`;
    apiClient
      .get<Invoice>(url)
      .then((data) => {
        setInvoice(data);
        document.title = `${data.number} | ${t('billing.title')}`;
      })
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : t('common.error')));
  }, [id, isRBACLoading, isSysadmin, t]);

  if (isRBACLoading) return <PageContainer><ListPageSkeleton /></PageContainer>;
  if (!authorize({ roles: ['ADMIN', 'SYSADMIN'] })) forbidden();
  if (error) return <PageContainer><ErrorAlert message={error} /></PageContainer>;
  if (!invoice) return <PageContainer><ListPageSkeleton /></PageContainer>;

  const money = (v: string) => formatMoney(v, invoice.currency);
  const period =
    invoice.periodStart && invoice.periodEnd ? `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}` : null;
  const backHref = isSysadmin ? '/plugins/subscriptions' : '/billing';

  return (
    <PageContainer>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={backHref}>
          <Button variant="ghost" size="sm"><ChevronLeft className="mr-1 h-4 w-4" />{t('billing.invoice.back')}</Button>
        </Link>
        <Button size="sm" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />{t('billing.invoice.print')}</Button>
      </div>

      <article className="mx-auto max-w-3xl rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t('billing.invoice.title', { number: invoice.number })}</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {t('billing.invoice.issuedOn')} {formatDate(invoice.issuedAt)} · {t('billing.invoice.dueOn')} {formatDate(invoice.dueAt)}
            </div>
          </div>
          <span className={cn('rounded border-2 px-3 py-1 text-lg font-bold uppercase tracking-widest', STAMP[invoice.status])}>
            {t(`billing.invoiceStatus.${invoice.status}`)}
          </span>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <PartyBlock label={t('billing.invoice.from')} taxLabel={t('billing.taxId')} party={invoice.sellerSnapshot} />
          <PartyBlock label={t('billing.invoice.billTo')} taxLabel={t('billing.taxId')} party={invoice.billToSnapshot} />
        </div>

        <table className="mt-8 w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">{t('billing.invoice.description')}</th>
              <th className="py-2 text-right font-medium">{t('billing.invoice.amount')}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-3">
                <div className="font-medium">{invoice.pluginName} — {t(`billing.model.${invoice.pricingModel}`)}</div>
                {invoice.includes && invoice.includes.length > 0 && (
                  <div className="text-muted-foreground">{t('billing.invoice.includes', { plugins: invoice.includes.map((p) => p.name).join(', ') })}</div>
                )}
                {period && <div className="text-muted-foreground">{t('billing.invoice.period')}: {period}</div>}
              </td>
              <td className="py-3 text-right">{money(invoice.subtotal)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>{t('billing.invoice.subtotal')}</dt><dd>{money(invoice.subtotal)}</dd></div>
          {Number(invoice.creditAmount) > 0 && (
            <div className="flex justify-between"><dt>{t('billing.invoice.credit')}</dt><dd>−{money(invoice.creditAmount)}</dd></div>
          )}
          {invoice.taxName && (
            <div className="flex justify-between">
              <dt>{invoice.taxName} {Number(invoice.taxRate)}%</dt><dd>{money(invoice.taxAmount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1 text-base font-bold">
            <dt>{t('billing.total')}</dt><dd>{money(invoice.total)}</dd>
          </div>
        </dl>

        {invoice.status === 'PAID' && invoice.paidAt && (
          <p className="mt-8 text-sm text-muted-foreground">
            {t('billing.invoice.paidOn')} {formatDate(invoice.paidAt)}
            {invoice.complimentary
              ? ` · ${t('billing.invoice.complimentary')}`
              : invoice.paymentMethod
                ? ` · ${invoice.paymentMethod}${invoice.paymentReference ? ` · ${t('billing.invoice.reference')} ${invoice.paymentReference}` : ''}`
                : ''}
          </p>
        )}
      </article>
    </PageContainer>
  );
}
