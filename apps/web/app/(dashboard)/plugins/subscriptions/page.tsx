'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { AlertTriangle, Play, Receipt, RefreshCw, Settings } from 'lucide-react';
import { toast } from 'sonner';
import {
  apiClient, ApiRequestError, Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Dialog,
  ErrorAlert, Input, Label, ListPageSkeleton, PageContainer, Pagination, StatsCard, Switch, formatDate, formatMoney,
  useApi, useLanguage, useRBAC,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';

interface Summary {
  paidThisMonth: { currency: string; amount: string }[];
  outstanding: { currency: string; amount: string }[];
  overdueTenants: number;
  activationFailures: number;
  disabledPaidPlugins: string[];
}

interface AdminInvoice {
  id: string;
  number: string;
  tenantSlug: string;
  pluginKey: string;
  pluginName: string;
  currency: string;
  total: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  issuedAt: string;
  dueAt: string;
  complimentary: boolean;
  activationError: string | null;
}

interface InvoicePage {
  data: AdminInvoice[];
  meta: { total: number; page: number; limit: number };
}

interface Settings {
  taxEnabled: boolean;
  taxName: string;
  taxRate: number;
  renewalLeadDays: number;
  graceDays: number;
  checkoutValidHours: number;
  sellerName: string | null;
  sellerAddress: string | null;
  sellerTaxId: string | null;
  sellerEmail: string | null;
}

const LIMIT = 20;
const STATUSES = ['', 'OPEN', 'OVERDUE', 'PAID', 'VOID'] as const;

const amounts = (list: { currency: string; amount: string }[]) =>
  list.length ? list.map((a) => formatMoney(a.amount, a.currency)).join(' · ') : '—';

/** Sysadmin: invoices across tenants, revenue, manual payments, billing settings. */
export default function BillingAdminPage() {
  const { t } = useLanguage();
  const { hasRole, isLoading: isRBACLoading } = useRBAC();

  const [filters, setFilters] = useState({ status: '', tenant: '', plugin: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);

  const summary = useApi<Summary>('/billing/admin/summary', undefined, { skip: isRBACLoading });
  const invoices = useApi<InvoicePage>(
    '/billing/admin/invoices',
    { page, limit: LIMIT, status: applied.status || undefined, tenant: applied.tenant || undefined, plugin: applied.plugin || undefined },
    { skip: isRBACLoading },
  );

  const [markPaid, setMarkPaid] = useState<AdminInvoice | null>(null);
  const [method, setMethod] = useState<'bank_transfer' | 'complimentary'>('bank_transfer');
  const [reference, setReference] = useState('');
  const [voidTarget, setVoidTarget] = useState<AdminInvoice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = `${t('billing.admin.title')} | SaaS Admin`;
  }, [t]);

  if (isRBACLoading) return <PageContainer><ListPageSkeleton /></PageContainer>;
  if (!hasRole('SYSADMIN')) forbidden();

  const refresh = () => Promise.all([summary.refetch(), invoices.refetch()]);
  const fail = (err: unknown) => toast.error(err instanceof ApiRequestError ? err.message : t('common.error'));

  const confirmMarkPaid = async () => {
    if (!markPaid) return;
    setBusy(true);
    try {
      await apiClient.post(`/billing/admin/invoices/${markPaid.id}/mark-paid`, { method, reference: reference || undefined });
      toast.success(t('billing.admin.markedPaid'));
      setMarkPaid(null);
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget) return;
    setBusy(true);
    try {
      await apiClient.post(`/billing/admin/invoices/${voidTarget.id}/void`);
      toast.success(t('billing.admin.voided'));
      setVoidTarget(null);
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const openSettings = async () => {
    try {
      setSettings(await apiClient.get<Settings>('/billing/admin/settings'));
      setSettingsOpen(true);
    } catch (err) {
      fail(err);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      await apiClient.put('/billing/admin/settings', {
        ...settings,
        taxRate: Number(settings.taxRate),
        renewalLeadDays: Number(settings.renewalLeadDays),
        graceDays: Number(settings.graceDays),
        checkoutValidHours: Number(settings.checkoutValidHours),
      });
      toast.success(t('billing.admin.settingsSaved'));
      setSettingsOpen(false);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const runJob = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post<{ tenants: number; actions: number; errors: unknown[]; skipped: boolean }>('/billing/admin/run-job');
      if (r.skipped) toast.info(t('billing.admin.jobSkipped'));
      else toast.success(t('billing.admin.jobResult', { tenants: r.tenants, actions: r.actions, errors: r.errors.length }));
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (i: AdminInvoice) => {
    if (i.status === 'OPEN' && new Date(i.dueAt).getTime() < Date.now()) {
      return <Badge variant="destructive">{t('billing.invoiceStatus.OVERDUE')}</Badge>;
    }
    const variant = ({ PAID: 'success', OPEN: 'warning', VOID: 'outline' } as const)[i.status];
    return (
      <span className="inline-flex items-center gap-1">
        <Badge variant={variant}>{t(`billing.invoiceStatus.${i.status}`)}</Badge>
        {i.complimentary && <Badge variant="outline">{t('billing.invoice.complimentary')}</Badge>}
      </span>
    );
  };

  // activationError: a code for an unexpected payment, or the error that stopped activation
  const attentionText = (error: string) =>
    error === 'paid_after_void' ? t('billing.admin.paidAfterVoid')
      : error === 'paid_twice' ? t('billing.admin.paidTwice')
        : t('billing.admin.activationErrorHint', { error });

  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s));

  const meta = invoices.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;

  return (
    <PageContainer>
      <PageHeader title={t('billing.admin.title')} description={t('billing.admin.description')}>
        <Button variant="outline" size="sm" onClick={openSettings}><Settings className="mr-1 h-4 w-4" />{t('billing.admin.settings')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={runJob}><Play className="mr-1 h-4 w-4" />{t('billing.admin.runJob')}</Button>
        <Button variant="ghost" size="icon" onClick={refresh} title="Refresh"><RefreshCw className="h-5 w-5" /></Button>
      </PageHeader>

      {summary.data && summary.data.disabledPaidPlugins.length > 0 && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t('billing.admin.disabledBanner', { plugins: summary.data.disabledPaidPlugins.join(', ') })}
        </div>
      )}

      {summary.error && <ErrorAlert message={summary.error} onRetry={summary.refetch} className="mb-4" />}
      {summary.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard label={t('billing.admin.paidThisMonth')} value={amounts(summary.data.paidThisMonth)} />
          <StatsCard label={t('billing.admin.outstanding')} value={amounts(summary.data.outstanding)} />
          <StatsCard label={t('billing.admin.overdueTenants')} value={summary.data.overdueTenants} />
          <StatsCard label={t('billing.admin.activationFailures')} value={summary.data.activationFailures} />
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>{t('billing.invoices')}</CardTitle></CardHeader>
        <CardContent>
          <form
            className="mb-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters); }}
          >
            <div className="grid gap-1">
              <Label htmlFor="f-status">{t('billing.status')}</Label>
              <select
                id="f-status"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s ? t(`billing.invoiceStatus.${s}`) : t('billing.admin.all')}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="f-tenant">{t('billing.admin.tenant')}</Label>
              <Input id="f-tenant" value={filters.tenant} onChange={(e) => setFilters((f) => ({ ...f, tenant: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="f-plugin">{t('billing.admin.pluginKey')}</Label>
              <Input id="f-plugin" value={filters.plugin} onChange={(e) => setFilters((f) => ({ ...f, plugin: e.target.value }))} />
            </div>
            <Button type="submit" size="sm">{t('billing.admin.apply')}</Button>
          </form>

          {invoices.error ? (
            <ErrorAlert message={invoices.error} onRetry={invoices.refetch} />
          ) : invoices.loading ? (
            <ListPageSkeleton />
          ) : !invoices.data?.data.length ? (
            <p className="text-sm text-muted-foreground">{t('billing.admin.noInvoices')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">{t('billing.number')}</th>
                    <th className="py-2 pr-4 font-medium">{t('billing.admin.tenantCol')}</th>
                    <th className="py-2 pr-4 font-medium">{t('billing.plugin')}</th>
                    <th className="py-2 pr-4 font-medium">{t('billing.issued')}</th>
                    <th className="py-2 pr-4 font-medium">{t('billing.total')}</th>
                    <th className="py-2 pr-4 font-medium">{t('billing.status')}</th>
                    <th className="py-2 text-right font-medium">{t('billing.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.data.data.map((i) => (
                    <tr key={i.id} className="border-t border-border">
                      <td className="py-3 pr-4 font-mono text-xs">
                        {i.number}
                        {i.activationError && (
                          <span title={attentionText(i.activationError)}>
                            <AlertTriangle className="ml-1 inline h-4 w-4 text-destructive" />
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">{i.tenantSlug}</td>
                      <td className="py-3 pr-4">{i.pluginName}</td>
                      <td className="py-3 pr-4">{formatDate(i.issuedAt)}</td>
                      <td className="py-3 pr-4">{formatMoney(i.total, i.currency)}</td>
                      <td className="py-3 pr-4">{statusBadge(i)}</td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {i.status === 'OPEN' && (
                            <>
                              <Button size="sm" onClick={() => { setMarkPaid(i); setMethod('bank_transfer'); setReference(''); }}>
                                {t('billing.admin.markPaid')}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setVoidTarget(i)}>{t('billing.admin.void')}</Button>
                            </>
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
              {totalPages > 1 && <Pagination className="mt-4" currentPage={page} totalPages={totalPages} onPageChange={setPage} />}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog isOpen={markPaid !== null} onClose={() => setMarkPaid(null)} title={t('billing.admin.markPaidTitle', { number: markPaid?.number ?? '' })} size="md" showFooter={false}>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); confirmMarkPaid(); }}>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('billing.admin.method')}</legend>
            {(['bank_transfer', 'complimentary'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
                {t(m === 'bank_transfer' ? 'billing.admin.bankTransfer' : 'billing.admin.complimentary')}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="mp-ref">{t('billing.admin.reference')}</Label>
            <Input id="mp-ref" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMarkPaid(null)}>{t('billing.close')}</Button>
            <Button type="submit" disabled={busy}>{t('billing.admin.confirmPaid')}</Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        isOpen={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        onConfirm={confirmVoid}
        loading={busy}
        variant="destructive"
        title={t('billing.admin.voidTitle')}
        description={t('billing.admin.voidConfirm', { number: voidTarget?.number ?? '' })}
        confirmText={t('billing.admin.void')}
        cancelText={t('billing.close')}
      />

      <Dialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title={t('billing.admin.settings')} size="lg" showFooter={false}>
        {settings && (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={settings.taxEnabled} onCheckedChange={(v: boolean) => setSetting('taxEnabled', v)} />
              {t('billing.admin.taxEnabled')}
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="s-taxName">{t('billing.admin.taxName')}</Label>
                <Input id="s-taxName" value={settings.taxName} onChange={(e) => setSetting('taxName', e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="s-taxRate">{t('billing.admin.taxRate')}</Label>
                <Input id="s-taxRate" type="number" min={0} max={100} step="0.01" value={settings.taxRate} onChange={(e) => setSetting('taxRate', e.target.value as unknown as number)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="s-lead">{t('billing.admin.renewalLeadDays')}</Label>
                <Input id="s-lead" type="number" min={0} max={60} value={settings.renewalLeadDays} onChange={(e) => setSetting('renewalLeadDays', e.target.value as unknown as number)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="s-grace">{t('billing.admin.graceDays')}</Label>
                <Input id="s-grace" type="number" min={0} max={60} value={settings.graceDays} onChange={(e) => setSetting('graceDays', e.target.value as unknown as number)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="s-hours">{t('billing.admin.checkoutValidHours')}</Label>
                <Input id="s-hours" type="number" min={1} max={720} value={settings.checkoutValidHours} onChange={(e) => setSetting('checkoutValidHours', e.target.value as unknown as number)} />
              </div>
            </div>
            <div className="text-sm font-medium">{t('billing.admin.seller')}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['sellerName', 'sellerAddress', 'sellerTaxId', 'sellerEmail'] as const).map((key) => (
                <div key={key} className="grid gap-1.5">
                  <Label htmlFor={`s-${key}`}>{t(`billing.admin.${key}`)}</Label>
                  <Input
                    id={`s-${key}`}
                    type={key === 'sellerEmail' ? 'email' : 'text'}
                    value={settings[key] ?? ''}
                    onChange={(e) => setSetting(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>{t('billing.close')}</Button>
              <Button type="submit" disabled={busy}>{t('billing.save')}</Button>
            </div>
          </form>
        )}
      </Dialog>
    </PageContainer>
  );
}
