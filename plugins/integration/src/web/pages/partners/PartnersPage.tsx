'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, Edit, Trash2,
  RefreshCw, X, ChevronDown, ChevronUp, Eye, MoreHorizontal,
} from 'lucide-react';
import {
  apiClient, cn, PageContainer, PageHeader, Pagination, PageInfo,
  SortableHeader, Button, Input, Checkbox, Protect, ConfirmDialog, Select,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  Card, CardHeader, CardContent, CardFooter,
  useRBAC, useLanguage, Forbidden, formatDate, formatDateTime,
} from '@saas/ui';
import { toast } from 'sonner';
import { PartnerDialog } from './PartnerDialog';
import { PartnerStatusDialog } from './PartnerStatusDialog';

interface Partner {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Inactive', value: 'INACTIVE' },
  { label: 'Suspended', value: 'SUSPENDED' },
];

export const PartnersPage = () => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  const [items, setItems] = useState<Partner[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState('');

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Create/Edit dialog state
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Partner | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);

  // Status dialog state
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusItem, setStatusItem] = useState<Partner | null>(null);

  // Mobile expand state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== debouncedSearch) {
        setDebouncedSearch(search);
        setMeta((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

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
      if (statusFilter) params.status = statusFilter;

      const data = await apiClient.get<{ data: Partner[]; meta: Meta }>('/plugins/integration/partners', params);
      setItems(data.data);
      setMeta(data.meta);
    } catch {
      toast.error(t('integration.partners.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRBACLoading) {
      fetchItems();
    }
  }, [meta.page, meta.limit, debouncedSearch, sortBy, sortOrder, statusFilter, isRBACLoading]);

  if (isRBACLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['integration.partner.read'] })) {
    return <Forbidden />;
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

  const handleEdit = (item: Partner) => {
    setSelectedItem(item);
    setIsViewMode(false);
    setItemDialogOpen(true);
  };

  const handleView = (item: Partner) => {
    setSelectedItem(item);
    setIsViewMode(true);
    setItemDialogOpen(true);
  };

  const handleChangeStatus = (item: Partner) => {
    setStatusItem(item);
    setStatusDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setDeleteLoading(true);
    try {
      await apiClient.delete(`/plugins/integration/partners/${itemToDelete}`);
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      fetchItems();
      toast.success(t('integration.partners.deleteSuccess'));
    } catch {
      toast.error(t('integration.partners.deleteError'));
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
      await apiClient.post('/plugins/integration/partners/bulk-delete', { ids: Array.from(selectedIds) });
      setBulkDeleteDialogOpen(false);
      setSelectedIds(new Set());
      fetchItems();
      toast.success(t('integration.partners.bulkDeleteSuccess'));
    } catch {
      toast.error(t('integration.partners.deleteError'));
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const getStatusBadge = (status: Partner['status']) => {
    const styles: Record<string, string> = {
      ACTIVE: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
      INACTIVE: 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400',
      SUSPENDED: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
    };
    const labels: Record<string, string> = {
      ACTIVE: t('integration.partners.statusActive'),
      INACTIVE: t('integration.partners.statusInactive'),
      SUSPENDED: t('integration.partners.statusSuspended'),
    };
    return (
      <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium border', styles[status])}>
        {labels[status]}
      </span>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('integration.partners.title')}
        description={t('integration.partners.description')}
      >
        <Protect roles={["ADMIN"]} permissions={['integration.partner.read']}>
          <Button onClick={fetchItems} variant="outline" className="gap-2">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            {t('integration.partners.refresh')}
          </Button>
        </Protect>
        <Protect roles={["ADMIN"]} permissions={['integration.partner.write']}>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="w-4 h-4" /> {t('integration.partners.create')}
          </Button>
        </Protect>
      </PageHeader>

      <Card className="overflow-hidden">
        <CardHeader
          className="p-4"
          toolbar={
            <>
              <div className="hidden sm:flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <Protect roles={["ADMIN"]} permissions={['integration.partner.write']}>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-2"
                      onClick={() => setBulkDeleteDialogOpen(true)}
                    >
                      <Trash2 className="w-4 h-4" /> {t('integration.partners.deleteSelected', { count: selectedIds.size })}
                    </Button>
                  </Protect>
                )}
              </div>
            </>
          }
        >
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <div className="relative flex-1 lg:w-72 lg:flex-none">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('integration.partners.search')}
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
                value={statusFilter}
                onChange={(val) => {
                  setStatusFilter(val);
                  setMeta((prev) => ({ ...prev, page: 1 }));
                }}
                options={STATUS_OPTIONS}
                placeholder={t('integration.partners.status')}
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
                    <div className="flex justify-between items-start">
                      <div className="h-5 w-32 bg-muted animate-pulse rounded" />
                      <div className="h-8 w-8 bg-muted animate-pulse rounded" />
                    </div>
                    <div className="h-4 w-full bg-muted animate-pulse rounded" />
                    <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <Search className="h-8 w-8 opacity-50" />
                  <p>{t('integration.partners.noItems')}</p>
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
                            {item.name}
                          </button>
                          {getStatusBadge(item.status)}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-1">{item.code}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Protect roles={["ADMIN"]} permissions={['integration.partner.write']}>
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(item.id)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </Protect>
                        <Button variant="ghost" size="icon" onClick={() => toggleExpand(item.id)}>
                          {expandedIds.has(item.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                    {expandedIds.has(item.id) && (
                      <div className="px-4 pb-4 pt-0 bg-muted/20">
                        <div className="mt-3 space-y-3">
                          <div>
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.partners.contactName')}</span>
                            <p className="text-sm mt-1 text-foreground">{item.contactName || '-'}</p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.partners.contactEmail')}</span>
                            <p className="text-sm mt-1 text-foreground">{item.contactEmail || '-'}</p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.partners.createdAt')}</span>
                            <p className="text-sm mt-1 text-foreground">{formatDateTime(item.createdAt)}</p>
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
                    <SortableHeader field="code" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.partners.code')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.partners.name')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    {t('integration.partners.contactName')}
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.partners.status')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('integration.partners.createdAt')}
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
                      <td className="px-4 py-3"><div className="h-4 w-32 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-28 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-8 w-8 bg-muted animate-pulse rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-8 w-8 opacity-50" />
                        <p>{t('integration.partners.noItems')}</p>
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
                      <td className="px-4 py-4 align-middle font-mono text-sm text-muted-foreground">{item.code}</td>
                      <td className="px-4 py-4 align-middle text-md font-medium text-foreground">
                        <button
                          type="button"
                          className="hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                          onClick={() => handleView(item)}
                        >
                          {item.name}
                        </button>
                      </td>
                      <td className="px-4 py-4 align-middle text-muted-foreground">{item.contactName || '-'}</td>
                      <td className="px-4 py-4 align-middle">{getStatusBadge(item.status)}</td>
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
                              {t('integration.partners.view')}
                            </DropdownMenuItem>
                            <Protect roles={["ADMIN"]} permissions={['integration.partner.write']}>
                              <DropdownMenuItem onClick={() => handleEdit(item)}>
                                <Edit className="mr-2 h-4 w-4" />
                                {t('integration.partners.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleChangeStatus(item)}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                {t('integration.partners.changeStatus')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => handleDelete(item.id)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('integration.partners.delete')}
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
          <PageInfo
            currentPage={meta.page}
            limit={meta.limit}
            total={meta.total}
            className="hidden sm:block"
          />
          <Pagination
            currentPage={meta.page}
            totalPages={meta.totalPages}
            onPageChange={(page) => setMeta({ ...meta, page })}
          />
        </CardFooter>
      </Card>

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        title={t('integration.partners.confirmDelete')}
        description={t('integration.partners.confirmDeleteMessage')}
        confirmText={t('integration.partners.delete')}
        variant="destructive"
        loading={deleteLoading}
      />

      <PartnerDialog
        isOpen={itemDialogOpen}
        onClose={() => setItemDialogOpen(false)}
        onSuccess={fetchItems}
        partner={selectedItem}
        readOnly={isViewMode}
      />

      <PartnerStatusDialog
        isOpen={statusDialogOpen}
        onClose={() => setStatusDialogOpen(false)}
        onSuccess={fetchItems}
        partner={statusItem}
      />

      <ConfirmDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onConfirm={confirmBulkDelete}
        title={t('integration.partners.confirmBulkDelete')}
        description={t('integration.partners.confirmBulkDeleteMessage', { count: selectedIds.size })}
        confirmText={t('integration.partners.delete')}
        variant="destructive"
        loading={bulkDeleteLoading}
      />
    </PageContainer>
  );
};
