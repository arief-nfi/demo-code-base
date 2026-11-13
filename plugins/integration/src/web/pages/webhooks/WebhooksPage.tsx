'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, Edit, Trash2,
  RefreshCw, X, ChevronDown, ChevronUp, Eye, MoreHorizontal,
  Check, XCircle, Play, RotateCw, List,
} from 'lucide-react';
import {
  apiClient, cn, PageContainer, PageHeader, Pagination, PageInfo,
  SortableHeader, Button, Input, Checkbox, Protect, ConfirmDialog, Select,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  Card, CardHeader, CardContent, CardFooter,
  useRBAC, useLanguage, Forbidden, formatDate, formatDateTime,
} from '@saas/ui';
import { toast } from 'sonner';
import { WebhookDialog } from './WebhookDialog';
import { WebhookDeliveriesPage } from './WebhookDeliveriesPage';

interface Webhook {
  id: string;
  partnerId: string;
  eventId: string;
  url: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  partner?: { id: string; name: string; code: string };
  event?: { id: string; name: string; code: string };
}

interface Partner {
  id: string;
  name: string;
  code: string;
}

interface WebhookEvent {
  id: string;
  name: string;
  code: string;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const ACTIVE_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'true' },
  { label: 'Inactive', value: 'false' },
];

export const WebhooksPage = () => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  const [items, setItems] = useState<Webhook[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [activeFilter, setActiveFilter] = useState('');
  const [partnerFilter, setPartnerFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');

  // Partners & events for filters
  const [partners, setPartners] = useState<Partner[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Create/Edit dialog state
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Webhook | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);

  // Rotate secret dialog
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [rotateLoading, setRotateLoading] = useState(false);

  // Deliveries view
  const [deliveriesWebhookId, setDeliveriesWebhookId] = useState<string | null>(null);

  // Mobile expand state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  // Secret display
  const [secretDisplay, setSecretDisplay] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== debouncedSearch) {
        setDebouncedSearch(search);
        setMeta((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  // Load partners & events for filters
  useEffect(() => {
    if (isRBACLoading) return;
    apiClient.get<{ data: Partner[] }>('/plugins/integration/partners', { limit: 100 })
      .then((res) => setPartners(res.data))
      .catch(() => {});
    apiClient.get<{ data: WebhookEvent[] }>('/plugins/integration/webhook-events', { limit: 100 })
      .then((res) => setEvents(res.data))
      .catch(() => {});
  }, [isRBACLoading]);

  const fetchItems = async () => {
    if (isRBACLoading) return;
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page: meta.page,
        limit: meta.limit,
        sortBy,
        sortOrder,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (activeFilter) params.isActive = activeFilter;
      if (partnerFilter) params.partnerId = partnerFilter;
      if (eventFilter) params.eventId = eventFilter;

      const data = await apiClient.get<{ data: Webhook[]; meta: Meta }>('/plugins/integration/webhooks', params);
      setItems(data.data);
      setMeta(data.meta);
    } catch {
      toast.error(t('integration.webhooks.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRBACLoading) {
      fetchItems();
    }
  }, [meta.page, meta.limit, debouncedSearch, sortBy, sortOrder, activeFilter, partnerFilter, eventFilter, isRBACLoading]);

  if (isRBACLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['integration.webhook.read'] })) {
    return <Forbidden />;
  }

  // Show deliveries sub-page
  if (deliveriesWebhookId) {
    return (
      <WebhookDeliveriesPage
        webhookId={deliveriesWebhookId}
        onBack={() => setDeliveriesWebhookId(null)}
      />
    );
  }

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const handleDelete = (id: string) => {
    setItemToDelete(id);
    setDeleteDialogOpen(true);
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  const handleCreate = () => {
    setSelectedItem(null);
    setIsViewMode(false);
    setItemDialogOpen(true);
  };

  const handleEdit = (item: Webhook) => {
    setSelectedItem(item);
    setIsViewMode(false);
    setItemDialogOpen(true);
  };

  const handleView = (item: Webhook) => {
    setSelectedItem(item);
    setIsViewMode(true);
    setItemDialogOpen(true);
  };

  const handleTest = async (id: string) => {
    try {
      await apiClient.post(`/plugins/integration/webhooks/${id}/test`);
      toast.success(t('integration.webhooks.testSuccess'));
    } catch {
      toast.error(t('integration.webhooks.testFailed'));
    }
  };

  const handleRotateSecret = (id: string) => {
    setRotateId(id);
    setRotateDialogOpen(true);
  };

  const confirmRotateSecret = async () => {
    if (!rotateId) return;
    setRotateLoading(true);
    try {
      const result = await apiClient.post<{ secret: string }>(`/plugins/integration/webhooks/${rotateId}/rotate-secret`);
      setRotateDialogOpen(false);
      setRotateId(null);
      setSecretDisplay(result.secret);
      toast.success(t('integration.webhooks.rotateSecretSuccess'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('integration.webhooks.saveError');
      toast.error(message);
    } finally {
      setRotateLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setDeleteLoading(true);
    try {
      await apiClient.delete(`/plugins/integration/webhooks/${itemToDelete}`);
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      fetchItems();
      toast.success(t('integration.webhooks.deleteSuccess'));
    } catch {
      toast.error(t('integration.webhooks.deleteError'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const next = new Set(selectedIds);
      items.forEach((item) => next.add(item.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      items.forEach((item) => next.delete(item.id));
      setSelectedIds(next);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const confirmBulkDelete = async () => {
    setBulkDeleteLoading(true);
    try {
      await apiClient.post('/plugins/integration/webhooks/bulk-delete', { ids: Array.from(selectedIds) });
      setBulkDeleteDialogOpen(false);
      setSelectedIds(new Set());
      fetchItems();
      toast.success(t('integration.webhooks.bulkDeleteSuccess'));
    } catch {
      toast.error(t('integration.webhooks.deleteError'));
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const getActiveBadge = (isActive: boolean) => {
    if (isActive) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium border bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400">
          <Check className="h-3 w-3" />
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium border bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400">
        <XCircle className="h-3 w-3" />
      </span>
    );
  };

  const partnerOptions = [
    { label: 'All Partners', value: '' },
    ...partners.map((p) => ({ label: p.name, value: p.id })),
  ];

  const eventOptions = [
    { label: 'All Events', value: '' },
    ...events.map((e) => ({ label: `${e.code} — ${e.name}`, value: e.id })),
  ];

  const handleDialogSuccess = (secret?: string) => {
    fetchItems();
    if (secret) {
      setSecretDisplay(secret);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('integration.webhooks.title')}
        description={t('integration.webhooks.description')}
      >
        <Protect roles={["ADMIN"]} permissions={['integration.webhook.read']}>
          <Button onClick={fetchItems} variant="outline" className="gap-2">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            {t('integration.webhooks.refresh')}
          </Button>
        </Protect>
        <Protect roles={["ADMIN"]} permissions={['integration.webhook.write']}>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="w-4 h-4" /> {t('integration.webhooks.create')}
          </Button>
        </Protect>
      </PageHeader>

      {/* Secret display alert */}
      {secretDisplay && (
        <div className="mb-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
          <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-2">
            {t('integration.webhooks.secretWarning')}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">{secretDisplay}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(secretDisplay);
                toast.success('Copied!');
              }}
            >
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSecretDisplay(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          className="p-4"
          toolbar={
            <>
              <div className="hidden sm:flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <Protect roles={["ADMIN"]} permissions={['integration.webhook.write']}>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-2"
                      onClick={() => setBulkDeleteDialogOpen(true)}
                    >
                      <Trash2 className="w-4 h-4" /> {t('integration.webhooks.deleteSelected', { count: selectedIds.size })}
                    </Button>
                  </Protect>
                )}
              </div>
            </>
          }
        >
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <div className="relative flex-1 lg:w-64 lg:flex-none">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('integration.webhooks.search')}
                className="pl-9 pr-8 h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSearch('')}
                  className="absolute right-1 top-1 h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="w-full lg:w-40">
              <Select
                value={partnerFilter}
                onChange={(val) => { setPartnerFilter(val); setMeta((prev) => ({ ...prev, page: 1 })); }}
                options={partnerOptions}
                placeholder={t('integration.webhooks.partner')}
              />
            </div>
            <div className="w-full lg:w-48">
              <Select
                value={eventFilter}
                onChange={(val) => { setEventFilter(val); setMeta((prev) => ({ ...prev, page: 1 })); }}
                options={eventOptions}
                placeholder={t('integration.webhooks.event')}
              />
            </div>
            <div className="w-full lg:w-28">
              <Select
                value={activeFilter}
                onChange={(val) => { setActiveFilter(val); setMeta((prev) => ({ ...prev, page: 1 })); }}
                options={ACTIVE_OPTIONS}
                placeholder={t('integration.webhooks.isActive')}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent padded={false}>
          {/* Mobile List View */}
          <div className="md:hidden border-border">
            {loading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-4 space-y-3">
                    <div className="h-5 w-48 bg-muted animate-pulse rounded" />
                    <div className="h-4 w-full bg-muted animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <Search className="h-8 w-8 opacity-50" />
                  <p>{t('integration.webhooks.noItems')}</p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="bg-card transition-all duration-200 hover:bg-muted/50">
                    <div className="p-4 flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <button
                            type="button"
                            className="font-semibold text-foreground truncate hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                            onClick={() => handleView(item)}
                          >
                            {item.partner?.name ?? item.partnerId}
                          </button>
                          {getActiveBadge(item.isActive)}
                        </div>
                        <p className="text-sm text-muted-foreground font-mono truncate">{item.url}</p>
                        <p className="text-xs text-muted-foreground">{item.event?.code}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => toggleExpand(item.id)}>
                          {expandedIds.has(item.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                    {expandedIds.has(item.id) && (
                      <div className="px-4 pb-4 pt-0 bg-muted/20">
                        <div className="mt-3 space-y-3">
                          <div>
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.event')}</span>
                            <p className="text-sm mt-1 text-foreground">{item.event?.name} ({item.event?.code})</p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.createdAt')}</span>
                            <p className="text-sm mt-1 text-foreground">{formatDateTime(item.createdAt)}</p>
                          </div>
                          <div className="flex gap-2 pt-2">
                            <Protect roles={["ADMIN"]} permissions={['integration.webhook.write']}>
                              <Button size="sm" variant="outline" onClick={() => handleEdit(item)}>
                                <Edit className="w-3 h-3 mr-1" /> {t('integration.webhooks.edit')}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleTest(item.id)}>
                                <Play className="w-3 h-3 mr-1" /> {t('integration.webhooks.test')}
                              </Button>
                            </Protect>
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b [&_tr]:border-border bg-muted/30 sticky top-0 z-10">
                <tr className="border-b border-border transition-colors data-[state=selected]:bg-muted">
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground w-[40px]">
                    <Checkbox
                      checked={items.length > 0 && items.every(item => selectedIds.has(item.id))}
                      indeterminate={items.some(item => selectedIds.has(item.id)) && !items.every(item => selectedIds.has(item.id))}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.webhooks.partner')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.webhooks.event')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="url" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.webhooks.url')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground w-[60px]">
                    {t('integration.webhooks.isActive')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.webhooks.createdAt')}
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
                      <td className="px-4 py-3"><div className="h-4 w-4 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-28 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-40 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-8 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-8 w-8 bg-muted animate-pulse rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-8 w-8 opacity-50" />
                        <p>{t('integration.webhooks.noItems')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b border-border bg-card transition-colors duration-50 hover:bg-muted/50 data-[state=selected]:bg-muted group">
                      <td className="px-4 py-4 align-middle">
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onChange={(e) => handleSelectOne(item.id, e.target.checked)}
                        />
                      </td>
                      <td className="px-4 py-4 align-middle text-sm font-medium text-foreground">{item.partner?.name ?? '-'}</td>
                      <td className="px-4 py-4 align-middle">
                        <span className="text-sm font-mono text-muted-foreground">{item.event?.code ?? '-'}</span>
                      </td>
                      <td className="px-4 py-4 align-middle">
                        <button
                          type="button"
                          className="text-sm font-mono text-muted-foreground max-w-[280px] truncate block hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                          onClick={() => handleView(item)}
                        >
                          {item.url}
                        </button>
                      </td>
                      <td className="px-4 py-4 align-middle">{getActiveBadge(item.isActive)}</td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">{formatDate(item.createdAt)}</td>
                      <td className="px-4 py-4 align-middle text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleView(item)}>
                              <Eye className="mr-2 h-4 w-4" />
                              {t('integration.webhooks.view')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeliveriesWebhookId(item.id)}>
                              <List className="mr-2 h-4 w-4" />
                              {t('integration.webhooks.viewDeliveries')}
                            </DropdownMenuItem>
                            <Protect roles={["ADMIN"]} permissions={['integration.webhook.write']}>
                              <DropdownMenuItem onClick={() => handleEdit(item)}>
                                <Edit className="mr-2 h-4 w-4" />
                                {t('integration.webhooks.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleTest(item.id)}>
                                <Play className="mr-2 h-4 w-4" />
                                {t('integration.webhooks.test')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleRotateSecret(item.id)}>
                                <RotateCw className="mr-2 h-4 w-4" />
                                {t('integration.webhooks.rotateSecret')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => handleDelete(item.id)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('integration.webhooks.delete')}
                              </DropdownMenuItem>
                            </Protect>
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

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        title={t('integration.webhooks.confirmDelete')}
        description={t('integration.webhooks.confirmDeleteMessage')}
        confirmText={t('integration.webhooks.delete')}
        variant="destructive"
        loading={deleteLoading}
      />

      <ConfirmDialog
        isOpen={rotateDialogOpen}
        onClose={() => setRotateDialogOpen(false)}
        onConfirm={confirmRotateSecret}
        title={t('integration.webhooks.confirmRotateSecret')}
        description={t('integration.webhooks.confirmRotateSecretMessage')}
        confirmText={t('integration.webhooks.rotateSecret')}
        variant="destructive"
        loading={rotateLoading}
      />

      <WebhookDialog
        isOpen={itemDialogOpen}
        onClose={() => setItemDialogOpen(false)}
        onSuccess={handleDialogSuccess}
        webhook={selectedItem}
        readOnly={isViewMode}
        partners={partners}
        events={events}
      />

      <ConfirmDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onConfirm={confirmBulkDelete}
        title={t('integration.webhooks.confirmBulkDelete')}
        description={t('integration.webhooks.confirmBulkDeleteMessage', { count: selectedIds.size })}
        confirmText={t('integration.webhooks.delete')}
        variant="destructive"
        loading={bulkDeleteLoading}
      />
    </PageContainer>
  );
};
