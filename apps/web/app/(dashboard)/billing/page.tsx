'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { AlertTriangle, Pencil, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import {
  apiClient, ApiRequestError, Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Dialog,
  ErrorAlert, Input, Label, ListPageSkeleton, PageContainer, formatDate, formatMoney, useApi, useAuthStore,
  useLanguage, useRBAC,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';

interface SubscriptionRow {
  /** Product key: a plugin key, or `app:<key>`. */
  pluginKey: string;
  pluginName: string;
  kind: 'plugin' | 'app';
  /** App rows: the plugins it includes. */
  includes: string[];
  /** App rows: the plugins that switch off when it ends (nothing else gives them). */
  switchesOff: string[];
  status: string;
  displayStatus: string;
  pricingModel: string;
  price: string | null;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  resumable: boolean;
  nextInvoiceAt: string | null;
  openInvoiceId: string | null;
}

interface InvoiceRow {
  id: string;
  number: string;
  pluginName: string;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  total: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  issuedAt: string;
  dueAt: string;
}

interface Profile {
  companyName: string | null;
  billingEmail: string | null;
  address: string | null;
  taxId: string | null;
}

const ENDS_NOW = ['TRIAL', 'PENDING_PAYMENT', 'PAST_DUE', 'PAUSED'];
const DAY_MS = 24 * 60 * 60 * 1000;

const isOverdue = (i: InvoiceRow) => i.status === 'OPEN' && new Date(i.dueAt).getTime() < Date.now();

function canCancel(s: SubscriptionRow): boolean {
  if (s.status === 'ACTIVE') return s.displayStatus !== 'OWNED' && !s.cancelAtPeriodEnd;
  return ENDS_NOW.includes(s.status);
}

export default function BillingPage() {
  const { t } = useLanguage();
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const tenantName = useAuthStore((s) => s.tenantName);

  const subscriptions = useApi<SubscriptionRow[]>('/billing/subscriptions', undefined, { skip: isRBACLoading });
  const invoices = useApi<InvoiceRow[]>('/billing/invoices', undefined, { skip: isRBACLoading });
  const profile = useApi<Profile>('/billing/profile', undefined, { skip: isRBACLoading });
  const credit = useApi<Array<{ currency: string; amount: string }>>('/billing/credit', undefined, { skip: isRBACLoading });

  const [cancelTarget, setCancelTarget] = useState<SubscriptionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Profile>({ companyName: '', billingEmail: '', address: '', taxId: '' });
  const returnHandled = useRef(false);

  useEffect(() => {
    document.title = `${t('billing.title')} | ${tenantName || 'SaaS Admin'}`;
  }, [tenantName, t]);

  // Back from the payment page: /billing?paid=<number> or ?payment=failed&invoice=<number>
  useEffect(() => {
    // Once per page load: React StrictMode runs mount effects twice in dev
    if (returnHandled.current) return;
    returnHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const paid = params.get('paid');
    const failed = params.get('payment') === 'failed';
    if (!paid && !failed) return;
    if (paid) toast.success(t('billing.paidToast', { invoice: paid }));
    else toast.error(t('billing.failedToast', { invoice: params.get('invoice') ?? '' }));
    // Drop the query so a reload doesn't repeat the message
    window.history.replaceState(null, '', '/billing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isRBACLoading) return <PageContainer><ListPageSkeleton /></PageContainer>;
  if (!authorize({ roles: ['ADMIN'] })) forbidden();

  const error = subscriptions.error || invoices.error || profile.error;
  if (error) {
    return (
      <PageContainer>
        <ErrorAlert message={error} onRetry={() => { subscriptions.refetch(); invoices.refetch(); profile.refetch(); }} />
      </PageContainer>
    );
  }
  if (subscriptions.loading || invoices.loading || profile.loading) {
    return <PageContainer><ListPageSkeleton /></PageContainer>;
  }

  const subs = subscriptions.data ?? [];
  const invs = invoices.data ?? [];
  const overdue = invs.filter(isOverdue);
  const refresh = () => Promise.all([subscriptions.refetch(), invoices.refetch(), credit.refetch()]);

  const pay = async (invoiceId: string) => {
    setBusy(true);
    try {
      const { checkoutUrl } = await apiClient.post<{ checkoutUrl: string }>(`/billing/invoices/${invoiceId}/pay`);
      window.location.assign(checkoutUrl);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('common.error'));
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await apiClient.post(`/billing/subscriptions/${encodeURIComponent(cancelTarget.pluginKey)}/cancel`);
      toast.success(t('billing.cancelled'));
      setCancelTarget(null);
      await refresh();
      window.dispatchEvent(new Event('plugins-updated'));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const resume = async (s: SubscriptionRow) => {
    try {
      await apiClient.post(`/billing/subscriptions/${encodeURIComponent(s.pluginKey)}/resume`);
      toast.success(t('billing.resumed'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('common.error'));
    }
  };

  const openEdit = () => {
    const p = profile.data;
    setForm({ companyName: p?.companyName ?? '', billingEmail: p?.billingEmail ?? '', address: p?.address ?? '', taxId: p?.taxId ?? '' });
    setEditOpen(true);
  };

  const saveProfile = async () => {
    setBusy(true);
    try {
      await apiClient.put('/billing/profile', form);
      toast.success(t('billing.saved'));
      setEditOpen(false);
      await profile.refetch();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (s: SubscriptionRow) => {
    if (s.status === 'ACTIVE' && s.cancelAtPeriodEnd && s.currentPeriodEnd) {
      return <Badge variant="warning">{t('billing.endsOn', { date: formatDate(s.currentPeriodEnd) })}</Badge>;
    }
    if (s.status === 'TRIAL' && s.trialEndsAt) {
      const days = Math.max(0, Math.ceil((new Date(s.trialEndsAt).getTime() - Date.now()) / DAY_MS));
      return <Badge variant="warning">{t('billing.trialDaysLeft', { days })}</Badge>;
    }
    const variant = ({ ACTIVE: 'success', OWNED: 'success', PAST_DUE: 'destructive', PAUSED: 'destructive' } as const)[
      s.displayStatus as 'ACTIVE'
    ] ?? 'outline';
    return <Badge variant={variant}>{t(`billing.statusLabel.${s.displayStatus}`)}</Badge>;
  };

  const invoiceBadge = (i: InvoiceRow) => {
    if (isOverdue(i)) return <Badge variant="destructive">{t('billing.invoiceStatus.OVERDUE')}</Badge>;
    const variant = ({ PAID: 'success', OPEN: 'warning', VOID: 'outline' } as const)[i.status];
    return <Badge variant={variant}>{t(`billing.invoiceStatus.${i.status}`)}</Badge>;
  };

  const period = (start: string | null, end: string | null) =>
    start && end ? `${formatDate(start)} – ${formatDate(end)}` : start ? formatDate(start) : '—';

  return (
    <PageContainer>
      <PageHeader title={t('billing.title')} description={t('billing.description')} />

      {overdue.length > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('billing.overdueBanner', { count: overdue.length })}
          </span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => pay(overdue[0].id)}>
            {t('billing.payNow')}
          </Button>
        </div>
      )}

      {(credit.data ?? []).map((c) => (
        <p key={c.currency} className="mb-4 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
          {t('billing.creditLine', { amount: formatMoney(c.amount, c.currency) })}
        </p>
      ))}

      <div className="grid gap-6">
        <Card>
          <CardHeader><CardTitle>{t('billing.subscriptions')}</CardTitle></CardHeader>
          <CardContent>
            {subs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('billing.noSubscriptions')} <Link href="/plugins/tenant" className="underline">{t('billing.browsePlugins')}</Link>
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">{t('billing.plugin')}</th>
                      <th className="py-2 pr-4 font-medium">{t('billing.plan')}</th>
                      <th className="py-2 pr-4 font-medium">{t('billing.status')}</th>
                      <th className="py-2 pr-4 font-medium">{t('billing.currentPeriod')}</th>
                      <th className="py-2 pr-4 font-medium">{t('billing.nextInvoice')}</th>
                      <th className="py-2 font-medium text-right">{t('billing.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.pluginKey} className="border-t border-border">
                        <td className="py-3 pr-4">
                          <span className="flex items-center gap-2 font-medium">
                            {s.pluginName}
                            {s.kind === 'app' && <Badge variant="outline">{t('billing.appTag')}</Badge>}
                          </span>
                          {s.kind === 'app' && s.includes.length > 0 && (
                            <span className="block text-xs text-muted-foreground">{s.includes.join(', ')}</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          {t(`billing.model.${s.pricingModel}`)}
                          {s.price && s.pricingModel !== 'FREE' ? ` · ${formatMoney(s.price, s.currency)}` : ''}
                        </td>
                        <td className="py-3 pr-4">{statusBadge(s)}</td>
                        <td className="py-3 pr-4">{period(s.currentPeriodStart, s.currentPeriodEnd)}</td>
                        <td className="py-3 pr-4">{s.nextInvoiceAt ? formatDate(s.nextInvoiceAt) : '—'}</td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {s.openInvoiceId && (
                              <Button size="sm" disabled={busy} onClick={() => pay(s.openInvoiceId!)}>{t('billing.pay')}</Button>
                            )}
                            {s.resumable && (
                              <Button size="sm" variant="outline" onClick={() => resume(s)}>{t('billing.undoCancel')}</Button>
                            )}
                            {canCancel(s) && (
                              <Button size="sm" variant="ghost" onClick={() => setCancelTarget(s)}>{t('billing.cancel')}</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('billing.invoices')}</CardTitle></CardHeader>
          <CardContent>
            {invs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('billing.noInvoices')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">{t('billing.number')}</th>
                      <th className="py-2 pr-4 font-medium">{t('billing.issued')}</th>
                      <th className="py-2 pr-4 font-medium">{t('billing.for')}</th>
                      <th className="py-2 pr-4 font-medium">{t('billing.total')}</th>
                      <th className="py-2 pr-4 font-medium">{t('billing.status')}</th>
                      <th className="py-2 font-medium text-right">{t('billing.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invs.map((i) => (
                      <tr key={i.id} className="border-t border-border">
                        <td className="py-3 pr-4 font-mono text-xs">{i.number}</td>
                        <td className="py-3 pr-4">{formatDate(i.issuedAt)}</td>
                        <td className="py-3 pr-4">
                          {i.pluginName}
                          {i.periodStart && i.periodEnd && (
                            <span className="text-muted-foreground"> · {period(i.periodStart, i.periodEnd)}</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">{formatMoney(i.total, i.currency)}</td>
                        <td className="py-3 pr-4">{invoiceBadge(i)}</td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {i.status === 'OPEN' && (
                              <Button size="sm" disabled={busy} onClick={() => pay(i.id)}>{t('billing.pay')}</Button>
                            )}
                            <Link href={`/billing/invoices/${i.id}`}>
                              <Button size="sm" variant="outline"><Receipt className="mr-1 h-4 w-4" />{t('billing.view')}</Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{t('billing.details')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t('billing.detailsHint')}</p>
            </div>
            <Button size="sm" variant="outline" onClick={openEdit}><Pencil className="mr-1 h-4 w-4" />{t('billing.editDetails')}</Button>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {(['companyName', 'billingEmail', 'address', 'taxId'] as const).map((field) => (
                <div key={field}>
                  <dt className="text-muted-foreground">{t(`billing.${field}`)}</dt>
                  <dd className="font-medium">{profile.data?.[field] || <span className="text-muted-foreground">{t('billing.notSet')}</span>}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
        loading={busy}
        variant="destructive"
        title={t('billing.cancelTitle')}
        description={
          (cancelTarget?.status === 'ACTIVE' && cancelTarget.currentPeriodEnd
            ? t('billing.cancelAtEnd', { plugin: cancelTarget.pluginName, date: formatDate(cancelTarget.currentPeriodEnd) })
            : t('billing.cancelNow', { plugin: cancelTarget?.pluginName ?? '' })) +
          // An app: which of its plugins go off with it, and which stay (free, or had another way)
          (cancelTarget?.kind === 'app' && cancelTarget.switchesOff.length
            ? ` ${t('billing.cancelAppOff', { plugins: cancelTarget.switchesOff.join(', ') })}`
            : '') +
          (cancelTarget?.kind === 'app' && cancelTarget.includes.some((name) => !cancelTarget.switchesOff.includes(name))
            ? ` ${t('billing.cancelAppKept', { plugins: cancelTarget.includes.filter((name) => !cancelTarget.switchesOff.includes(name)).join(', ') })}`
            : '')
        }
        confirmText={t('billing.cancelTitle')}
        cancelText={t('billing.keep')}
      />

      <Dialog isOpen={editOpen} onClose={() => setEditOpen(false)} title={t('billing.editDetails')} size="md" showFooter={false}>
        <form
          className="grid gap-4"
          onSubmit={(e) => { e.preventDefault(); saveProfile(); }}
        >
          {(['companyName', 'billingEmail', 'address', 'taxId'] as const).map((field) => (
            <div key={field} className="grid gap-1.5">
              <Label htmlFor={`billing-${field}`}>{t(`billing.${field}`)}</Label>
              <Input
                id={`billing-${field}`}
                type={field === 'billingEmail' ? 'email' : 'text'}
                value={form[field] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>{t('billing.close')}</Button>
            <Button type="submit" disabled={busy}>{t('billing.save')}</Button>
          </div>
        </form>
      </Dialog>
    </PageContainer>
  );
}
