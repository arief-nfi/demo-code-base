'use client';

import { useState, useEffect } from 'react';
import {
  Search, RefreshCw, ArrowLeft, Eye, RotateCw, MoreHorizontal,
} from 'lucide-react';
import {
  apiClient, cn, PageContainer, PageHeader, Pagination, PageInfo,
  SortableHeader, Button, Select,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  Card, CardHeader, CardContent, CardFooter,
  useLanguage, formatDateTime,
} from '@saas/ui';
import { toast } from 'sonner';
import { DeliveryDetailDialog } from './DeliveryDetailDialog';

interface Delivery {
  id: string;
  webhookId: string;
  eventCode: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING';
  httpStatus?: number | null;
  attempt: number;
  duration?: number | null;
  payload?: unknown | null;
  responseBody?: string | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
  nextRetryAt?: string | null;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface WebhookDeliveriesPageProps {
  webhookId: string;
  onBack: () => void;
}

const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Success', value: 'SUCCESS' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Retrying', value: 'RETRYING' },
];

export const WebhookDeliveriesPage = ({ webhookId, onBack }: WebhookDeliveriesPageProps) => {
  const { t } = useLanguage();

  const [items, setItems] = useState<Delivery[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState('');

  // Detail dialog
  const [detailItem, setDetailItem] = useState<Delivery | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page: meta.page,
        limit: meta.limit,
        sortBy,
        sortOrder,
      };
      if (statusFilter) params.status = statusFilter;

      const data = await apiClient.get<{ data: Delivery[]; meta: Meta }>(
        `/plugins/integration/webhooks/${webhookId}/deliveries`,
        params,
      );
      setItems(data.data);
      setMeta(data.meta);
    } catch {
      toast.error(t('integration.webhooks.deliveries.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [meta.page, meta.limit, sortBy, sortOrder, statusFilter]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const handleRetry = async (deliveryId: string) => {
    try {
      await apiClient.post(`/plugins/integration/webhooks/${webhookId}/deliveries/${deliveryId}/retry`);
      toast.success(t('integration.webhooks.deliveries.retrySuccess'));
      fetchItems();
    } catch {
      toast.error(t('integration.webhooks.deliveries.retryError'));
    }
  };

  const getStatusBadge = (status: Delivery['status']) => {
    const styles: Record<string, string> = {
      PENDING: 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400',
      SUCCESS: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
      FAILED: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
      RETRYING: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
    };
    const labelKeys: Record<string, string> = {
      PENDING: 'integration.webhooks.deliveries.statusPending',
      SUCCESS: 'integration.webhooks.deliveries.statusSuccess',
      FAILED: 'integration.webhooks.deliveries.statusFailed',
      RETRYING: 'integration.webhooks.deliveries.statusRetrying',
    };
    return (
      <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium border', styles[status])}>
        {t(labelKeys[status])}
      </span>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('integration.webhooks.deliveries.title')}
        description={t('integration.webhooks.deliveries.description')}
      >
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={fetchItems} variant="outline" className="gap-2">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </PageHeader>

      <Card className="overflow-hidden">
        <CardHeader className="p-4">
          <div className="w-36">
            <Select
              value={statusFilter}
              onChange={(val) => { setStatusFilter(val); setMeta((prev) => ({ ...prev, page: 1 })); }}
              options={STATUS_OPTIONS}
              placeholder={t('integration.webhooks.deliveries.status')}
            />
          </div>
        </CardHeader>

        <CardContent padded={false}>
          {/* Mobile List View */}
          <div className="md:hidden border-border">
            {loading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-4 space-y-2">
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <Search className="h-8 w-8 opacity-50" />
                  <p>{t('integration.webhooks.deliveries.noItems')}</p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="p-4 bg-card hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm text-muted-foreground">{item.eventCode}</span>
                      {getStatusBadge(item.status)}
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>#{item.attempt} {item.httpStatus ? `(${item.httpStatus})` : ''} {item.duration != null ? `${item.duration}ms` : ''}</span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailItem(item)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        {item.status === 'FAILED' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRetry(item.id)}>
                            <RotateCw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b [&_tr]:border-border bg-muted/30 sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.webhooks.deliveries.eventCode')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.webhooks.deliveries.status')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.webhooks.deliveries.httpStatus')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.webhooks.deliveries.attempt')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.webhooks.deliveries.duration')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.webhooks.deliveries.createdAt')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-right align-middle font-medium text-muted-foreground">
                    {/* Actions */}
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-10 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-6 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-12 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-8 w-8 bg-muted animate-pulse rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-8 w-8 opacity-50" />
                        <p>{t('integration.webhooks.deliveries.noItems')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b border-border bg-card transition-colors duration-50 hover:bg-muted/50">
                      <td className="px-4 py-4 align-middle font-mono text-sm text-muted-foreground">{item.eventCode}</td>
                      <td className="px-4 py-4 align-middle">{getStatusBadge(item.status)}</td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">{item.httpStatus ?? '-'}</td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">{item.attempt}</td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">
                        {item.duration != null ? `${item.duration}ms` : '-'}
                      </td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">{formatDateTime(item.createdAt)}</td>
                      <td className="px-4 py-4 align-middle text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDetailItem(item)}>
                              <Eye className="mr-2 h-4 w-4" />
                              {t('integration.webhooks.deliveries.viewDetails')}
                            </DropdownMenuItem>
                            {item.status === 'FAILED' && (
                              <DropdownMenuItem onClick={() => handleRetry(item.id)}>
                                <RotateCw className="mr-2 h-4 w-4" />
                                {t('integration.webhooks.deliveries.retry')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>

        <CardFooter align="between">
          <PageInfo currentPage={meta.page} limit={meta.limit} total={meta.total} className="hidden sm:block" />
          <Pagination currentPage={meta.page} totalPages={meta.totalPages} onPageChange={(page) => setMeta({ ...meta, page })} />
        </CardFooter>
      </Card>

      <DeliveryDetailDialog
        isOpen={!!detailItem}
        onClose={() => setDetailItem(null)}
        delivery={detailItem}
      />
    </PageContainer>
  );
};
