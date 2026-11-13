'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, Edit, Trash2, RefreshCw, Eye, MoreHorizontal, ShieldOff, RotateCw, Copy, X,
} from 'lucide-react';
import {
  apiClient, cn, PageContainer, PageHeader, Pagination, PageInfo,
  SortableHeader, Button, Input, Checkbox, Protect, ConfirmDialog, Select,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  Card, CardHeader, CardContent, CardFooter,
  useRBAC, useLanguage, Forbidden, formatDate, formatDateTime,
} from '@saas/ui';
import { toast } from 'sonner';
import { ApiKeyDialog } from './ApiKeyDialog';
import { RevokeConfirmDialog } from './RevokeConfirmDialog';

interface ApiKey {
  id: string;
  partnerId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  partner?: { id: string; code: string; name: string };
}

interface Partner {
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

const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'true' },
  { label: 'Revoked / Expired', value: 'false' },
];

export const ApiKeysPage = () => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  const [items, setItems] = useState<ApiKey[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [activeFilter, setActiveFilter] = useState('');
  const [partnerFilter, setPartnerFilter] = useState('');

  // Partners for filter + dialog
  const [partners, setPartners] = useState<Partner[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogItem, setDialogItem] = useState<ApiKey | null>(null);
  const [dialogReadOnly, setDialogReadOnly] = useState(false);

  // Revoke / Regenerate dialog
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeMode, setRevokeMode] = useState<'revoke' | 'regenerate'>('revoke');
  const [revokeItemId, setRevokeItemId] = useState<string | null>(null);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Raw key display
  const [rawKey, setRawKey] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPartners = async () => {
    try {
      const data = await apiClient.get<{ data: Partner[] }>('/plugins/integration/partners', { limit: 100 });
      setPartners(data.data);
    } catch { /* ignore */ }
  };

  const fetchItems = async () => {
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

      const data = await apiClient.get<{ data: ApiKey[]; meta: Meta }>(
        '/plugins/integration/api-keys',
        params,
      );
      setItems(data.data);
      setMeta(data.meta);
    } catch {
      toast.error(t('integration.apiKeys.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPartners();
  }, []);

  useEffect(() => {
    fetchItems();
  }, [meta.page, meta.limit, sortBy, sortOrder, debouncedSearch, activeFilter, partnerFilter]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // Status helpers
  const getKeyStatus = (item: ApiKey): 'active' | 'revoked' | 'expired' => {
    if (item.revokedAt || !item.isActive) return 'revoked';
    if (item.expiresAt && new Date(item.expiresAt) < new Date()) return 'expired';
    return 'active';
  };

  const getStatusBadge = (item: ApiKey) => {
    const status = getKeyStatus(item);
    const styles: Record<string, string> = {
      active: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
      revoked: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
      expired: 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400',
    };
    const labelKeys: Record<string, string> = {
      active: 'integration.apiKeys.statusActive',
      revoked: 'integration.apiKeys.statusRevoked',
      expired: 'integration.apiKeys.statusExpired',
    };
    return (
      <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium border', styles[status])}>
        {t(labelKeys[status])}
      </span>
    );
  };

  // Actions
  const openCreate = () => {
    setDialogItem(null);
    setDialogReadOnly(false);
    setDialogOpen(true);
  };

  const openView = (item: ApiKey) => {
    setDialogItem(item);
    setDialogReadOnly(true);
    setDialogOpen(true);
  };

  const openEdit = (item: ApiKey) => {
    setDialogItem(item);
    setDialogReadOnly(false);
    setDialogOpen(true);
  };

  const openRevoke = (id: string) => {
    setRevokeItemId(id);
    setRevokeMode('revoke');
    setRevokeDialogOpen(true);
  };

  const openRegenerate = (id: string) => {
    setRevokeItemId(id);
    setRevokeMode('regenerate');
    setRevokeDialogOpen(true);
  };

  const handleRevoke = async () => {
    if (!revokeItemId) return;
    try {
      await apiClient.post(`/plugins/integration/api-keys/${revokeItemId}/revoke`);
      toast.success(t('integration.apiKeys.revokeSuccess'));
      setRevokeDialogOpen(false);
      fetchItems();
    } catch {
      toast.error(t('integration.apiKeys.revokeError'));
    }
  };

  const handleRegenerate = async () => {
    if (!revokeItemId) return;
    try {
      const result = await apiClient.post<{ apiKey: ApiKey; rawKey: string }>(
        `/plugins/integration/api-keys/${revokeItemId}/regenerate`,
      );
      toast.success(t('integration.apiKeys.regenerateSuccess'));
      setRevokeDialogOpen(false);
      setRawKey(result.rawKey);
      fetchItems();
    } catch {
      toast.error(t('integration.apiKeys.regenerateError'));
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    try {
      await apiClient.delete(`/plugins/integration/api-keys/${itemToDelete}`);
      toast.success(t('integration.apiKeys.deleteSuccess'));
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      fetchItems();
    } catch {
      toast.error(t('integration.apiKeys.deleteError'));
    }
  };

  const handleBulkDelete = async () => {
    try {
      await apiClient.post('/plugins/integration/api-keys/bulk-delete', { ids: Array.from(selectedIds) });
      toast.success(t('integration.apiKeys.bulkDeleteSuccess'));
      setBulkDeleteDialogOpen(false);
      setSelectedIds(new Set());
      fetchItems();
    } catch {
      toast.error(t('integration.apiKeys.deleteError'));
    }
  };

  const handleDialogSuccess = (key?: string) => {
    if (key) setRawKey(key);
    fetchItems();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const partnerFilterOptions = [
    { label: 'All Partners', value: '' },
    ...partners.map((p) => ({ label: p.name, value: p.id })),
  ];

  if (!isRBACLoading && !authorize({ permissions: ['integration.api-key.read'] })) {
    return <Forbidden />;
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('integration.apiKeys.title')}
        description={t('integration.apiKeys.description')}
      >
        <Button onClick={fetchItems} variant="outline" className="gap-2">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </Button>
        <Protect permissions={['integration.api-key.write']}>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> {t('integration.apiKeys.create')}
          </Button>
        </Protect>
      </PageHeader>

      {/* Raw key alert */}
      {rawKey && (
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                {t('integration.apiKeys.rawKeyWarning')}
              </p>
              <code className="block text-sm font-mono bg-background/50 rounded px-3 py-2 break-all text-foreground">
                {rawKey}
              </code>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(rawKey)}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRawKey(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <div className="relative flex-1 lg:w-72 lg:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('integration.apiKeys.search')}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setMeta((prev) => ({ ...prev, page: 1 })); }}
                className="pl-9"
              />
            </div>
            <div className="w-full lg:w-36">
              <Select
                value={partnerFilter}
                onChange={(val) => { setPartnerFilter(val); setMeta((prev) => ({ ...prev, page: 1 })); }}
                options={partnerFilterOptions}
                placeholder={t('integration.apiKeys.partner')}
              />
            </div>
            <div className="w-full lg:w-36">
              <Select
                value={activeFilter}
                onChange={(val) => { setActiveFilter(val); setMeta((prev) => ({ ...prev, page: 1 })); }}
                options={STATUS_OPTIONS}
                placeholder={t('integration.apiKeys.status')}
              />
            </div>
            {selectedIds.size > 0 && (
              <Protect permissions={['integration.api-key.write']}>
                <Button variant="destructive" size="sm" className="gap-2 whitespace-nowrap lg:ml-auto" onClick={() => setBulkDeleteDialogOpen(true)}>
                  <Trash2 className="h-3 w-3" />
                  {t('integration.apiKeys.deleteSelected').replace('{count}', String(selectedIds.size))}
                </Button>
              </Protect>
            )}
          </div>
        </CardHeader>

        <CardContent padded={false}>
          {/* Mobile List View */}
          <div className="md:hidden border-border">
            {loading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-4 space-y-2">
                    <div className="h-4 w-40 bg-muted animate-pulse rounded" />
                    <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <Search className="h-8 w-8 opacity-50" />
                  <p>{t('integration.apiKeys.noItems')}</p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="p-4 bg-card hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                        />
                        <span className="font-medium text-foreground truncate">{item.name}</span>
                      </div>
                      {getStatusBadge(item)}
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="space-x-2">
                        <span className="font-mono">intk_{item.keyPrefix}...</span>
                        {item.partner && <span>· {item.partner.name}</span>}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openView(item)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        {getKeyStatus(item) === 'active' && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openRevoke(item.id)}>
                              <ShieldOff className="h-3 w-3" />
                            </Button>
                          </>
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
                  <th className="px-4 py-3 text-left align-middle w-10">
                    <Checkbox
                      checked={items.length > 0 && selectedIds.size === items.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.apiKeys.name')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.apiKeys.partner')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.apiKeys.prefix')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.apiKeys.scopes')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.apiKeys.expiresAt')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.apiKeys.lastUsedAt')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.apiKeys.status')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.apiKeys.createdAt')}
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
                      <td className="px-4 py-3"><div className="h-4 w-28 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-12 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-14 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-8 w-8 bg-muted animate-pulse rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-8 w-8 opacity-50" />
                        <p>{t('integration.apiKeys.noItems')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b border-border bg-card transition-colors duration-50 hover:bg-muted/50">
                      <td className="px-4 py-4 align-middle">
                        <Checkbox checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} />
                      </td>
                      <td className="px-4 py-4 align-middle font-medium text-foreground">{item.name}</td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">{item.partner?.name ?? '-'}</td>
                      <td className="px-4 py-4 align-middle font-mono text-sm text-muted-foreground">
                        intk_{item.keyPrefix}...
                      </td>
                      <td className="px-4 py-4 align-middle">
                        <div className="flex flex-wrap gap-1">
                          {(Array.isArray(item.scopes) ? item.scopes : []).map((scope) => (
                            <span
                              key={scope}
                              className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 border border-blue-500/20"
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">
                        {item.expiresAt ? formatDate(item.expiresAt) : t('integration.apiKeys.neverExpires')}
                      </td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">
                        {item.lastUsedAt ? formatDateTime(item.lastUsedAt) : t('integration.apiKeys.neverUsed')}
                      </td>
                      <td className="px-4 py-4 align-middle">{getStatusBadge(item)}</td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">{formatDateTime(item.createdAt)}</td>
                      <td className="px-4 py-4 align-middle text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openView(item)}>
                              <Eye className="mr-2 h-4 w-4" />
                              {t('integration.apiKeys.view')}
                            </DropdownMenuItem>
                            {getKeyStatus(item) === 'active' && (
                              <>
                                <DropdownMenuItem onClick={() => openEdit(item)}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  {t('integration.apiKeys.edit')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => openRevoke(item.id)}>
                                  <ShieldOff className="mr-2 h-4 w-4" />
                                  {t('integration.apiKeys.revoke')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openRegenerate(item.id)}>
                                  <RotateCw className="mr-2 h-4 w-4" />
                                  {t('integration.apiKeys.regenerate')}
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => { setItemToDelete(item.id); setDeleteDialogOpen(true); }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('integration.apiKeys.delete')}
                            </DropdownMenuItem>
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

      {/* Dialogs */}
      <ApiKeyDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={handleDialogSuccess}
        apiKey={dialogItem}
        readOnly={dialogReadOnly}
        partners={partners}
      />

      <RevokeConfirmDialog
        isOpen={revokeDialogOpen}
        onClose={() => setRevokeDialogOpen(false)}
        onConfirm={revokeMode === 'revoke' ? handleRevoke : handleRegenerate}
        mode={revokeMode}
      />

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => { setDeleteDialogOpen(false); setItemToDelete(null); }}
        onConfirm={handleDelete}
        title={t('integration.apiKeys.confirmDelete')}
        description={t('integration.apiKeys.confirmDeleteMessage')}
        confirmText={t('integration.apiKeys.delete')}
        variant="destructive"
      />

      <ConfirmDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onConfirm={handleBulkDelete}
        title={t('integration.apiKeys.confirmBulkDelete')}
        description={t('integration.apiKeys.confirmBulkDeleteMessage').replace('{count}', String(selectedIds.size))}
        confirmText={t('integration.apiKeys.deleteSelected').replace('{count}', String(selectedIds.size))}
        variant="destructive"
      />
    </PageContainer>
  );
};
