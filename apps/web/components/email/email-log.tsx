'use client';

import { useCallback, useEffect, useState } from 'react';
import { EyeOff, RefreshCw } from 'lucide-react';
import { apiClient, Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, ErrorAlert, formatDateTime, Input, Pagination, useLanguage } from '@saas/ui';
import { EmailMessageDialog } from './email-message-dialog';

export type EmailStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';

interface EmailRow {
  id: string;
  tenantSlug: string | null;
  templateKey: string;
  to: string[];
  subject: string;
  status: EmailStatus;
  attempts: number;
  redacted: boolean;
  isTest: boolean;
  /** `platform`: sent by the platform; in a workspace log, one it sent to this workspace */
  origin: EmailOrigin;
  createdAt: string;
}

type EmailOrigin = 'tenant' | 'platform';

interface EmailPage {
  data: EmailRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const STATUS_VARIANT: Record<EmailStatus, 'default' | 'success' | 'destructive' | 'outline'> = {
  QUEUED: 'default',
  SENT: 'success',
  FAILED: 'destructive',
  SKIPPED: 'outline',
};

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  const { t } = useLanguage();
  return <Badge variant={STATUS_VARIANT[status]}>{t(`email.status.${status}`)}</Badge>;
}

interface EmailLogProps {
  /** The tenant's own log, or the sysadmin's platform log */
  basePath: '/email/messages' | '/email/platform/messages';
  canRetry: boolean;
  showTenant?: boolean;
}

export function EmailLog({ basePath, canRetry, showTenant = false }: EmailLogProps) {
  const { t } = useLanguage();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<EmailStatus | ''>('');
  const [template, setTemplate] = useState('');
  const [debouncedTemplate, setDebouncedTemplate] = useState('');
  // A workspace log can show only its own emails or only the platform's; the platform log, one workspace's
  const tenantLog = basePath === '/email/messages';
  const [origin, setOrigin] = useState<EmailOrigin | ''>('');
  const [tenant, setTenant] = useState('');
  const [debouncedTenant, setDebouncedTenant] = useState('');
  const [result, setResult] = useState<EmailPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTemplate(template.trim()), 400);
    return () => clearTimeout(timer);
  }, [template]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTenant(tenant.trim()), 400);
    return () => clearTimeout(timer);
  }, [tenant]);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) query.set('status', status);
    if (debouncedTemplate) query.set('template', debouncedTemplate);
    if (tenantLog && origin) query.set('origin', origin);
    if (!tenantLog && debouncedTenant) query.set('tenant', debouncedTenant);
    try {
      setResult(await apiClient.get<EmailPage>(`${basePath}?${query}`));
      setError(null);
    } catch {
      setError(t('email.loadError'));
    } finally {
      setLoading(false);
    }
  }, [basePath, page, status, debouncedTemplate, tenantLog, origin, debouncedTenant, t]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = result?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{t('email.log')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as EmailStatus | ''); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label={t('email.colStatus')}
          >
            <option value="">{t('email.allStatuses')}</option>
            {(Object.keys(STATUS_VARIANT) as EmailStatus[]).map((s) => <option key={s} value={s}>{t(`email.status.${s}`)}</option>)}
          </select>
          {tenantLog ? (
            <select
              value={origin}
              onChange={(e) => { setOrigin(e.target.value as EmailOrigin | ''); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label={t('email.colFrom')}
            >
              <option value="">{t('email.originAll')}</option>
              <option value="tenant">{t('email.originTenant')}</option>
              <option value="platform">{t('email.originPlatform')}</option>
            </select>
          ) : (
            <Input
              value={tenant}
              onChange={(e) => { setTenant(e.target.value); setPage(1); }}
              placeholder={t('email.filterTenant')}
              className="h-9 w-56"
            />
          )}
          <Input
            value={template}
            onChange={(e) => { setTemplate(e.target.value); setPage(1); }}
            placeholder={t('email.filterTemplate')}
            className="h-9 w-72"
          />
          <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorAlert message={error} onRetry={load} />
        ) : rows.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">{t('email.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">{t('email.colDate')}</th>
                  {showTenant && <th className="py-2 pr-4 font-medium">{t('email.colTenant')}</th>}
                  {tenantLog && <th className="py-2 pr-4 font-medium">{t('email.colFrom')}</th>}
                  <th className="py-2 pr-4 font-medium">{t('email.colTo')}</th>
                  <th className="py-2 pr-4 font-medium">{t('email.colSubject')}</th>
                  <th className="py-2 pr-4 font-medium">{t('email.colTemplate')}</th>
                  <th className="py-2 pr-4 font-medium">{t('email.colStatus')}</th>
                  <th className="py-2 font-medium text-right">{t('email.colAttempts')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="cursor-pointer border-t border-border hover:bg-muted/50" onClick={() => setOpenId(row.id)}>
                    <td className="whitespace-nowrap py-3 pr-4">{formatDateTime(row.createdAt)}</td>
                    {showTenant && <td className="py-3 pr-4">{row.tenantSlug ?? '—'}</td>}
                    {tenantLog && (
                      <td className="py-3 pr-4">
                        {row.origin === 'platform' ? <Badge variant="outline">{t('email.originPlatform')}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                    )}
                    <td className="py-3 pr-4">{row.to.join(', ')}</td>
                    <td className="py-3 pr-4">
                      <span className="font-medium">{row.subject}</span>
                      {row.redacted && <EyeOff className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" aria-label={t('email.hidden')} />}
                      {row.isTest && <Badge variant="outline" className="ml-1.5">{t('email.test')}</Badge>}
                    </td>
                    <td className="py-3 pr-4"><code className="text-xs">{row.templateKey}</code></td>
                    <td className="py-3 pr-4"><EmailStatusBadge status={row.status} /></td>
                    <td className="py-3 text-right">{row.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && (
          <Pagination className="mt-4" currentPage={result.meta.page} totalPages={result.meta.totalPages} onPageChange={setPage} />
        )}
      </CardContent>

      <EmailMessageDialog basePath={basePath} id={openId} canRetry={canRetry} onClose={() => setOpenId(null)} onRetried={load} />
    </Card>
  );
}
