'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, XCircle } from 'lucide-react';
import {
  apiClient, Badge, Button, Card, CardHeader, CardTitle, CardContent, ConfirmDialog, Pagination, Select,
  useLanguage, formatDateTime,
} from '@saas/ui';
import { toast } from 'sonner';
import { GOOGLE_CALENDAR_API, STATUS_VARIANT, errorMessage, type MeetingRow, type MeetingStatus, type Page } from './types';

const PAGE_SIZE = 20;

/** The organization's Meet meetings, newest first, with Cancel for an item's current one. */
export function GoogleMeetingsCard() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<'' | MeetingStatus>('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<Page<MeetingRow> | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  /** The meeting whose Cancel was clicked, until it's confirmed: it ends a call in progress */
  const [confirming, setConfirming] = useState<MeetingRow | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await apiClient.get<Page<MeetingRow>>(`${GOOGLE_CALENDAR_API}/meetings`, { status: status || undefined, page, limit: PAGE_SIZE }));
    } catch (error) {
      toast.error(errorMessage(error, t('integration.googleMeet.loadError')));
    }
  }, [status, page, t]);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      const result = await apiClient.post<{ status: string; locked: boolean }>(`${GOOGLE_CALENDAR_API}/meetings/${id}/cancel`);
      if (result.locked) toast.success(t('integration.googleMeet.cancelled'));
      else toast.warning(t('integration.googleMeet.cancelledNotLocked'));
      await load();
    } catch (error) {
      toast.error(errorMessage(error, t('integration.googleMeet.cancelError')));
    } finally {
      setCancelling(null);
      setConfirming(null);
    }
  };

  const statusOptions = [
    { value: '', label: t('integration.googleMeet.filterAll') },
    ...(['ACTIVE', 'CANCELLED', 'ORPHANED'] as const).map((value) => ({ value, label: t(`integration.googleMeet.statuses.${value}`) })),
  ];

  return (
    <Card>
      <CardHeader
        toolbar={
          <Select
            className="w-44"
            value={status}
            options={statusOptions}
            onChange={(value) => {
              setStatus(value as '' | MeetingStatus);
              setPage(1);
            }}
          />
        }
      >
        <CardTitle>{t('integration.googleMeet.meetingsTitle')}</CardTitle>
      </CardHeader>
      <CardContent padded={false}>
        {list && list.data.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('integration.googleMeet.meetingsEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('integration.googleMeet.meeting')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleMeet.host')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleMeet.joining')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleMeet.statusLabel')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleMeet.created')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(list?.data ?? []).map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-4 py-2">
                      <span className="block font-medium">{row.title ?? '—'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.source} · {row.key}
                      </span>
                      {row.status === 'ACTIVE' && (
                        <a href={row.joinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline">
                          {row.joinUrl.replace('https://', '')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-2">{row.host?.name ?? row.host?.email ?? '—'}</td>
                    <td className="px-4 py-2">{t(`integration.googleMeet.access.${row.access}.label`)}</td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[row.status]}>{t(`integration.googleMeet.statuses.${row.status}`)}</Badge>
                      {row.lockState !== 'OPEN' && (
                        <span
                          className={`mt-1 block text-xs ${row.lockState === 'FAILED' ? 'text-destructive' : 'text-muted-foreground'}`}
                          title={row.lastError ?? undefined}
                        >
                          {t(`integration.googleMeet.lock.${row.lockState}`)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {row.status === 'ACTIVE' && row.current && (
                        <Button size="sm" variant="outline" className="gap-1.5" isLoading={cancelling === row.id} onClick={() => setConfirming(row)}>
                          <XCircle className="h-3.5 w-3.5" /> {t('integration.googleMeet.cancel')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list && <Pagination className="p-4" currentPage={list.meta.page} totalPages={list.meta.totalPages} onPageChange={setPage} />}
      </CardContent>

      <ConfirmDialog
        isOpen={!!confirming}
        onClose={() => !cancelling && setConfirming(null)}
        onConfirm={() => confirming && cancel(confirming.id)}
        title={t('integration.googleMeet.cancelConfirmTitle')}
        description={t('integration.googleMeet.cancelConfirmMessage')}
        confirmText={t('integration.googleMeet.cancelConfirm')}
        cancelText={t('integration.googleMeet.keep')}
        variant="destructive"
        loading={!!cancelling}
      />
    </Card>
  );
}
