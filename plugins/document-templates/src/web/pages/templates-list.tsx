'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, Edit, Trash2, Copy, RotateCcw,
  RefreshCw, X, MoreHorizontal, FileText, Download,
} from 'lucide-react';
import {
  apiClient, cn, PageContainer, PageHeader, Pagination, PageInfo,
  SortableHeader, Button, Input, Protect, ConfirmDialog, Badge,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  Card, CardHeader, CardContent, CardFooter,
  useRBAC, useLanguage, Forbidden, formatDateTime,
} from '@saas/ui';
import { toast } from 'sonner';

interface DocumentTemplate {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  category: string;
  paperSize: string;
  orientation: string;
  isDefault: boolean;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TemplatesListPageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  onNavigate?: (path: string) => void;
}

export const TemplatesListPage = ({ onNavigate }: TemplatesListPageProps) => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [installLoading, setInstallLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== debouncedSearch) {
        setDebouncedSearch(search);
        setMeta((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  const fetchTemplates = async () => {
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

      const data = await apiClient.get<{ data: DocumentTemplate[]; meta: Meta }>(
        '/plugins/document-templates/templates',
        params,
      );
      setTemplates(data.data);
      setMeta(data.meta);
    } catch (error) {
      console.warn('Failed to fetch templates', error);
      toast.error(t('documentTemplates.fetchError') || 'Failed to fetch templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRBACLoading) {
      fetchTemplates();
    }
  }, [meta.page, meta.limit, debouncedSearch, sortBy, sortOrder, isRBACLoading]);

  if (isRBACLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['document-templates.template.read'] })) {
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

  const handleEdit = (template: DocumentTemplate) => {
    if (onNavigate) {
      onNavigate(`/plugins/document-templates/templates/edit?id=${template.id}`);
    }
  };

  const handleCreate = () => {
    if (onNavigate) {
      onNavigate('/plugins/document-templates/templates/create');
    }
  };

  const handleDelete = (id: string) => {
    setTemplateToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!templateToDelete) return;
    setDeleteLoading(true);
    try {
      await apiClient.delete(`/plugins/document-templates/templates/${templateToDelete}`);
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
      fetchTemplates();
      toast.success(t('documentTemplates.deleteSuccess') || 'Template deleted');
    } catch (error) {
      console.error('Failed to delete template', error);
      toast.error(t('documentTemplates.deleteError') || 'Failed to delete template');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await apiClient.post(`/plugins/document-templates/templates/${id}/duplicate`);
      fetchTemplates();
      toast.success(t('documentTemplates.duplicateSuccess') || 'Template duplicated');
    } catch (error) {
      console.error('Failed to duplicate template', error);
      toast.error(t('documentTemplates.duplicateError') || 'Failed to duplicate template');
    }
  };

  const handleResetToDefault = async (id: string) => {
    try {
      await apiClient.post(`/plugins/document-templates/defaults/${id}/reset`);
      fetchTemplates();
      toast.success(t('documentTemplates.resetSuccess') || 'Template reset to default');
    } catch (error) {
      console.error('Failed to reset template', error);
      toast.error(t('documentTemplates.resetError') || 'Failed to reset template');
    }
  };

  const handleInstallDefaults = async () => {
    setInstallLoading(true);
    try {
      const result = await apiClient.post<{ installed: string[]; skipped: string[] }>(
        '/plugins/document-templates/defaults/install',
      );
      fetchTemplates();
      toast.success(
        `${result.installed.length} template(s) installed${result.skipped.length > 0 ? `, ${result.skipped.length} already existed` : ''}`,
      );
    } catch (error) {
      console.error('Failed to install defaults', error);
      toast.error(t('documentTemplates.installError') || 'Failed to install default templates');
    } finally {
      setInstallLoading(false);
    }
  };

  const getCategoryBadge = (category: string) => {
    const colors: Record<string, string> = {
      sales: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      purchasing: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      inventory: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      general: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
    };
    return (
      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', colors[category] || colors.general)}>
        {category}
      </span>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('documentTemplates.title') || 'Document Templates'}
        description={t('documentTemplates.description') || 'Manage document templates for PDF and HTML generation'}
      >
        <Protect roles={['ADMIN']} permissions={['document-templates.template.read']}>
          <Button onClick={fetchTemplates} variant="outline" className="gap-2">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </Protect>
        <Protect roles={['ADMIN']} permissions={['document-templates.template.create']}>
          <Button onClick={handleInstallDefaults} variant="outline" className="gap-2" disabled={installLoading}>
            <Download className="w-4 h-4" />
            {installLoading ? 'Installing...' : t('documentTemplates.installDefaults') || 'Install Defaults'}
          </Button>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="w-4 h-4" /> {t('documentTemplates.createTemplate') || 'Create Template'}
          </Button>
        </Protect>
      </PageHeader>

      <Card className="overflow-hidden">
        <CardHeader className="p-4">
          <div className="relative flex-1 sm:w-72 sm:flex-none">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('documentTemplates.search') || 'Search templates...'}
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
          {/* Mobile view */}
          <div className="md:hidden">
            {loading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-4 space-y-3">
                    <div className="h-5 w-40 bg-muted animate-pulse rounded" />
                    <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : templates.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">{t('documentTemplates.noTemplates') || 'No templates found'}</p>
                <p className="text-sm mt-1">{t('documentTemplates.noTemplatesDescription') || 'Get started by creating a new template or installing the defaults.'}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {templates.map((tmpl) => (
                  <li key={tmpl.id} className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <button type="button" className="font-semibold hover:text-primary text-left" onClick={() => handleEdit(tmpl)}>
                          {tmpl.name}
                        </button>
                        <div className="flex items-center gap-2 mt-1">
                          {getCategoryBadge(tmpl.category)}
                          {tmpl.isDefault && <Badge variant="outline" className="text-xs">Default</Badge>}
                          {!tmpl.isActive && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{tmpl.slug} &middot; v{tmpl.version}</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(tmpl)}>
                            <Edit className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(tmpl.id)}>
                            <Copy className="mr-2 h-4 w-4" /> Duplicate
                          </DropdownMenuItem>
                          {tmpl.isDefault && (
                            <DropdownMenuItem onClick={() => handleResetToDefault(tmpl.id)}>
                              <RotateCcw className="mr-2 h-4 w-4" /> Reset to Default
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => handleDelete(tmpl.id)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b [&_tr]:border-border bg-muted/30 sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      Name
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">Slug</th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="category" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      Category
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader field="updatedAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                      Last Updated
                    </SortableHeader>
                  </th>
                  <th className="px-4 py-3 text-right align-middle font-medium text-muted-foreground" />
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="px-4 py-3"><div className="h-4 w-36 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-28 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-3"><div className="h-8 w-8 bg-muted animate-pulse rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : templates.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">{t('documentTemplates.noTemplates') || 'No templates found'}</p>
                      <p className="text-sm mt-1">{t('documentTemplates.noTemplatesDescription') || 'Get started by creating a template or installing the defaults.'}</p>
                    </td>
                  </tr>
                ) : (
                  templates.map((tmpl) => (
                    <tr key={tmpl.id} className="border-b border-border bg-card hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-4 align-middle">
                        <button type="button" className="font-medium hover:text-primary hover:underline text-left" onClick={() => handleEdit(tmpl)}>
                          {tmpl.name}
                        </button>
                        {tmpl.description && <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{tmpl.description}</p>}
                      </td>
                      <td className="px-4 py-4 align-middle text-muted-foreground font-mono text-xs">{tmpl.slug}</td>
                      <td className="px-4 py-4 align-middle">{getCategoryBadge(tmpl.category)}</td>
                      <td className="px-4 py-4 align-middle">
                        <div className="flex items-center gap-1.5">
                          {tmpl.isActive ? (
                            <Badge variant="default" className="text-xs">Active</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">Inactive</Badge>
                          )}
                          {tmpl.isDefault && <Badge variant="outline" className="text-xs">Default</Badge>}
                          <span className="text-xs text-muted-foreground">v{tmpl.version}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-middle text-muted-foreground text-sm">{formatDateTime(tmpl.updatedAt)}</td>
                      <td className="px-4 py-4 align-middle text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(tmpl)}>
                              <Edit className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <Protect roles={['ADMIN']} permissions={['document-templates.template.create']}>
                              <DropdownMenuItem onClick={() => handleDuplicate(tmpl.id)}>
                                <Copy className="mr-2 h-4 w-4" /> Duplicate
                              </DropdownMenuItem>
                            </Protect>
                            {tmpl.isDefault && (
                              <Protect roles={['ADMIN']} permissions={['document-templates.template.update']}>
                                <DropdownMenuItem onClick={() => handleResetToDefault(tmpl.id)}>
                                  <RotateCcw className="mr-2 h-4 w-4" /> Reset to Default
                                </DropdownMenuItem>
                              </Protect>
                            )}
                            <DropdownMenuSeparator />
                            <Protect roles={['ADMIN']} permissions={['document-templates.template.delete']}>
                              <DropdownMenuItem variant="destructive" onClick={() => handleDelete(tmpl.id)}>
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
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
        title="Delete Template"
        description={t('documentTemplates.deleteConfirm') || 'Are you sure you want to delete this template? This action cannot be undone.'}
        confirmText="Delete"
        variant="destructive"
        loading={deleteLoading}
      />
    </PageContainer>
  );
};
