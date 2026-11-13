// plugins/sample-plugin/src/web/pages/sample-articles/SampleArticleListPage.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, Edit, Trash2, RefreshCw, X, Eye, MoreHorizontal, Star, FileText,
} from 'lucide-react';
import {
  apiClient, cn, PageContainer, PageHeader, Pagination, PageInfo,
  SortableHeader, Button, Input, Checkbox, Protect,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  Card, CardHeader, CardContent, CardFooter,
  useRBAC, useLanguage, Forbidden, formatDate,
} from '@saas/ui';
import { toast } from 'sonner';
import { DeleteSampleArticleDialog, type DeleteSampleArticleTarget } from './DeleteSampleArticleDialog';

interface SampleArticle {
  id: string;
  title: string;
  slug: string;
  body: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const SampleArticleListPage = ({
  onNavigate,
}: {
  onNavigate?: (path: string) => void;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
} = {}) => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  const [items, setItems] = useState<SampleArticle[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteSampleArticleTarget | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

      const data = await apiClient.get<{ data: SampleArticle[]; meta: Meta }>(
        '/plugins/sample-plugin/articles',
        params,
      );
      setItems(data.data);
      setMeta(data.meta);
    } catch (err) {
      console.warn('Failed to fetch sample articles', err);
      toast.error(t('samplePlugin.articles.list.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRBACLoading) fetchItems();
  }, [meta.page, meta.limit, debouncedSearch, sortBy, sortOrder, isRBACLoading]);

  if (isRBACLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['sample-plugin.article.read'] })) {
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

  const goCreate = () => onNavigate?.('/plugins/sample-plugin/articles/new');
  const goDetail = (id: string) => onNavigate?.(`/plugins/sample-plugin/articles/${id}`);
  const goEdit = (id: string) => onNavigate?.(`/plugins/sample-plugin/articles/${id}/edit`);

  const openSingleDelete = (id: string) => {
    setDeleteTarget({ kind: 'single', id });
    setDeleteOpen(true);
  };
  const openBulkDelete = () => {
    setDeleteTarget({ kind: 'bulk', ids: Array.from(selectedIds) });
    setDeleteOpen(true);
  };
  const onDeleteSuccess = () => {
    setSelectedIds(new Set());
    fetchItems();
  };

  const handleSelectAll = (checked: boolean) => {
    const next = new Set(selectedIds);
    items.forEach((it) => (checked ? next.add(it.id) : next.delete(it.id)));
    setSelectedIds(next);
  };
  const handleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const statusBadge = (status: SampleArticle['status']) => {
    const label = status === 'PUBLISHED'
      ? t('samplePlugin.articles.status.published')
      : t('samplePlugin.articles.status.draft');
    const classes = status === 'PUBLISHED'
      ? 'bg-primary/10 text-primary'
      : 'bg-muted text-muted-foreground';
    return (
      <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium', classes)}>
        {label}
      </span>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('samplePlugin.articles.list.title')}
        description={t('samplePlugin.articles.list.description')}
      >
        <Protect roles={['ADMIN']} permissions={['sample-plugin.article.read']}>
          <Button onClick={fetchItems} variant="outline" className="gap-2">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('samplePlugin.articles.list.refresh')}
          </Button>
        </Protect>
        <Protect roles={['ADMIN']} permissions={['sample-plugin.article.write']}>
          <Button onClick={goCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t('samplePlugin.articles.list.create')}
          </Button>
        </Protect>
      </PageHeader>

      <Card className="overflow-hidden">
        <CardHeader
          className="p-4"
          toolbar={
            <div className="hidden sm:flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Protect roles={['ADMIN']} permissions={['sample-plugin.article.write']}>
                  <Button variant="destructive" size="sm" className="gap-2" onClick={openBulkDelete}>
                    <Trash2 className="h-4 w-4" />
                    {t('samplePlugin.articles.list.deleteSelected', { count: selectedIds.size })}
                  </Button>
                </Protect>
              )}
            </div>
          }
        >
          <div className="relative flex-1 sm:w-72 sm:flex-none">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('samplePlugin.articles.list.search')}
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
        </CardHeader>

        <CardContent padded={false}>
          <div className="hidden md:block relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b [&_tr]:border-border bg-muted/30 sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 w-[40px]">
                    <Checkbox
                      checked={items.length > 0 && items.every((it) => selectedIds.has(it.id))}
                      indeterminate={items.some((it) => selectedIds.has(it.id)) && !items.every((it) => selectedIds.has(it.id))}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortableHeader field="title" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('samplePlugin.articles.list.title_')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    {t('samplePlugin.articles.list.slug')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortableHeader field="status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('samplePlugin.articles.list.status')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortableHeader field="publishedAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      {t('samplePlugin.articles.list.publishedAt')}
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    {t('samplePlugin.articles.list.featured')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground" />
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="px-4 py-3"><div className="h-4 w-4 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-40 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-32 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-8 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-8 w-8 bg-muted animate-pulse rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="h-8 w-8 opacity-50" />
                        <p>{t('samplePlugin.articles.list.noArticles')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b border-border bg-card hover:bg-muted/50">
                      <td className="px-4 py-4">
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onChange={(e) => handleSelectOne(item.id, e.target.checked)}
                        />
                      </td>
                      <td className="px-4 py-4 font-medium text-foreground">
                        <button
                          type="button"
                          className="text-left hover:underline hover:text-primary"
                          onClick={() => goDetail(item.id)}
                        >
                          {item.title}
                        </button>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{item.slug}</td>
                      <td className="px-4 py-4">{statusBadge(item.status)}</td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {item.publishedAt ? formatDate(item.publishedAt) : '—'}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {item.featured && <Star className="h-4 w-4 text-primary" fill="currentColor" />}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => goDetail(item.id)}>
                              <Eye className="mr-2 h-4 w-4" />
                              {t('samplePlugin.articles.list.view')}
                            </DropdownMenuItem>
                            <Protect roles={['ADMIN']} permissions={['sample-plugin.article.write']}>
                              <DropdownMenuItem onClick={() => goEdit(item.id)}>
                                <Edit className="mr-2 h-4 w-4" />
                                {t('samplePlugin.articles.list.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => openSingleDelete(item.id)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('samplePlugin.articles.list.delete')}
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
          <Pagination
            currentPage={meta.page}
            totalPages={meta.totalPages}
            onPageChange={(page) => setMeta({ ...meta, page })}
          />
        </CardFooter>
      </Card>

      <DeleteSampleArticleDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onSuccess={onDeleteSuccess}
        target={deleteTarget}
      />
    </PageContainer>
  );
};
