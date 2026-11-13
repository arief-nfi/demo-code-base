'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, Edit, Trash2,
  Download, RefreshCw, X,
  ChevronDown, ChevronUp, Eye, MoreHorizontal
} from 'lucide-react';
import { forbidden } from 'next/navigation';
import { toast } from 'sonner';
import {
  cn, ConfirmDialog, Pagination, PageInfo, PageContainer, SortableHeader,
  Button, Input, Checkbox, Protect, useRBAC, useAuthStore,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  ListPageSkeleton, SkeletonTable, EmptyState, ErrorAlert,
  Card, CardHeader, CardContent, CardFooter,
  usePaginatedApi, apiClient, ApiRequestError,
  formatDate, formatDateTime,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';
import { PermissionDialog } from './permission-dialog';

interface Permission {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export default function PermissionsPage() {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const storedTenantName = useAuthStore(s => s.tenantName);

  // Search, sort, pagination state
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  // Data fetching via hook
  const { data: permissions, meta, loading, error, refetch } = usePaginatedApi<Permission>(
    '/system/permissions',
    {
      page,
      limit,
      search,
      sortBy,
      sortOrder,
      skip: isRBACLoading,
      debounce: 500,
    },
  );

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [permissionToDelete, setPermissionToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // Create/Edit dialog state
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [selectedPermission, setSelectedPermission] = useState<Permission | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);

  // Mobile expand state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  useEffect(() => {
    document.title = `Permissions | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  if (isRBACLoading) {
    return <PageContainer><ListPageSkeleton /></PageContainer>;
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['system.permission.read']})) {
    forbidden();
  }

  if (error) {
    return <PageContainer><ErrorAlert message={error} onRetry={refetch} /></PageContainer>;
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
    setPermissionToDelete(id);
    setDeleteDialogOpen(true);
  };

  const toggleExpand = (id: string) => {
    const newExpandedIds = new Set(expandedIds);
    if (newExpandedIds.has(id)) {
      newExpandedIds.delete(id);
    } else {
      newExpandedIds.add(id);
    }
    setExpandedIds(newExpandedIds);
  };

  const handleCreate = () => {
    setSelectedPermission(null);
    setIsViewMode(false);
    setPermissionDialogOpen(true);
  };

  const handleEdit = (permission: Permission) => {
    setSelectedPermission(permission);
    setIsViewMode(false);
    setPermissionDialogOpen(true);
  };

  const handleView = (permission: Permission) => {
    setSelectedPermission(permission);
    setIsViewMode(true);
    setPermissionDialogOpen(true);
  };

  const handleSuccess = () => {
    refetch();
  };

  const confirmExport = async () => {
    setExportLoading(true);
    try {
      const csvData = await apiClient.get<string>('/system/permissions/export', {
        sortBy,
        sortOrder,
        search: search || undefined,
      });

      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'permissions.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Permissions exported successfully');
      setExportDialogOpen(false);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'An error occurred while exporting permissions';
      toast.error(message);
    } finally {
      setExportLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!permissionToDelete) return;

    setDeleteLoading(true);
    try {
      await apiClient.delete(`/system/permissions/${permissionToDelete}`);
      setDeleteDialogOpen(false);
      setPermissionToDelete(null);
      refetch();
      toast.success('Permission deleted successfully');
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'An error occurred while deleting permission';
      toast.error(message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSelected = new Set(selectedIds);
      permissions.forEach((p) => newSelected.add(p.id));
      setSelectedIds(newSelected);
    } else {
      const newSelected = new Set(selectedIds);
      permissions.forEach((p) => newSelected.delete(p.id));
      setSelectedIds(newSelected);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };

  const confirmBulkDelete = async () => {
    setBulkDeleteLoading(true);
    try {
      await apiClient.post('/system/permissions/bulk-delete', { ids: Array.from(selectedIds) });
      setBulkDeleteDialogOpen(false);
      setSelectedIds(new Set());
      refetch();
      toast.success('Selected permissions deleted successfully');
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'An error occurred while deleting permissions';
      toast.error(message);
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Permissions"
        description="Manage system permissions and access controls."
      >
        <Protect roles={['ADMIN']} permissions={['system.permission.read']}>
          <Button
            onClick={refetch}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </Protect>
        <Protect roles={['ADMIN']} permissions={['system.permission.write']}>
          <Button
            onClick={handleCreate}
            className="gap-2"
          >
            <Plus className="w-4 h-4" /> Create Permission
          </Button>
        </Protect>
      </PageHeader>

      <Card className="overflow-hidden">
        <CardHeader
          className="p-4"
          toolbar={
            <div className="hidden sm:flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Protect roles={['ADMIN']} permissions={['system.permission.write']}>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                    onClick={() => setBulkDeleteDialogOpen(true)}
                  >
                    <Trash2 className="w-4 h-4" /> Delete ({selectedIds.size})
                  </Button>
                </Protect>
              )}
              <Protect roles={['ADMIN']} permissions={['system.permission.read']}>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setExportDialogOpen(true)}>
                  <Download className="w-4 h-4" /> Export
                </Button>
              </Protect>
            </div>
          }
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-72 sm:flex-none">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search permissions..."
                className="pl-9 pr-8"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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
            <Protect roles={['ADMIN']} permissions={['system.permission.read']}>
              <Button variant="outline" size="icon" className="sm:hidden flex-shrink-0" title="Export" onClick={() => setExportDialogOpen(true)}>
                <Download className="w-4 h-4" />
              </Button>
            </Protect>
          </div>
        </CardHeader>

        <CardContent padded={false}>
        {/* Mobile List View */}
        <div className="md:hidden border-border">
          {loading ? (
            <div className="p-4">
              <SkeletonTable rows={3} cols={2} />
            </div>
          ) : permissions.length === 0 ? (
            <EmptyState
              icon={<Search className="h-8 w-8" />}
              title="No permissions found"
              description="No permissions found matching your criteria."
            />
          ) : (
            <ul className="divide-y divide-border">
              {permissions.map((permission) => (
                <li key={permission.id} className="bg-card transition-all duration-200 hover:bg-muted/50">
                  <div className="p-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          type="button"
                          className="font-semibold text-foreground truncate hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                          onClick={() => handleView(permission)}
                        >
                          {permission.name}
                        </button>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{permission.description}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Protect roles={['ADMIN']} permissions={['system.permission.write']}>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(permission)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(permission.id)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </Protect>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleExpand(permission.id)}
                      >
                        {expandedIds.has(permission.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  {expandedIds.has(permission.id) && (
                    <div className="px-4 pb-4 pt-0 bg-muted/20">
                      <div className="mt-3 space-y-3">
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</span>
                          <p className="text-sm mt-1 text-foreground">{permission.description}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Created At</span>
                          <p className="text-sm mt-1 text-foreground">{formatDateTime(permission.createdAt)}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ID</span>
                          <p className="text-xs mt-1 font-mono text-muted-foreground">{permission.id}</p>
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
                <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-[40px]">
                  <Checkbox
                    checked={permissions.length > 0 && permissions.every(p => selectedIds.has(p.id))}
                    indeterminate={permissions.some(p => selectedIds.has(p.id)) && !permissions.every(p => selectedIds.has(p.id))}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </th>
                <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                  <SortableHeader field="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    Name
                  </SortableHeader>
                </th>
                <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                  Description
                </th>
                <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                  <SortableHeader field="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    Created At
                  </SortableHeader>
                </th>
                <th className="px-4 py-3 text-right align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                  {/* Actions */}
                </th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-4 py-3"><div className="h-4 w-4 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-48 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-8 w-8 bg-muted animate-pulse rounded ml-auto" /></td>
                  </tr>
                ))
              ) : permissions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <EmptyState
                      icon={<Search className="h-8 w-8" />}
                      title="No permissions found"
                      description="No permissions found matching your criteria."
                    />
                  </td>
                </tr>
              ) : (
                permissions.map((permission) => (
                  <tr key={permission.id} className="border-b border-border bg-card transition-colors duration-50 hover:bg-muted/50 data-[state=selected]:bg-muted group">
                    <td className="px-4 py-3 align-middle">
                       <Checkbox
                          checked={selectedIds.has(permission.id)}
                          onChange={(e) => handleSelectOne(permission.id, e.target.checked)}
                        />
                    </td>
                    <td className="px-4 py-3 align-middle text-md font-medium text-foreground">
                      <button
                        type="button"
                        className="hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                        onClick={() => handleView(permission)}
                      >
                        {permission.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground max-w-md truncate">{permission.description}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">{formatDate(permission.createdAt)}</td>
                    <td className="px-4 py-3 align-middle text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleView(permission)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View
                          </DropdownMenuItem>
                          <Protect roles={['ADMIN']} permissions={['system.permission.write']}>
                            <DropdownMenuItem onClick={() => handleEdit(permission)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => handleDelete(permission.id)}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
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
            onPageChange={setPage}
          />
        </CardFooter>
      </Card>

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Permission"
        description="Are you sure you want to delete this permission? This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        loading={deleteLoading}
      />

      <ConfirmDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onConfirm={confirmExport}
        title="Export Permissions"
        description="Are you sure you want to export the permissions list to a CSV file?"
        confirmText="Export"
        loading={exportLoading}
      />

      <PermissionDialog
        isOpen={permissionDialogOpen}
        onClose={() => setPermissionDialogOpen(false)}
        onSuccess={handleSuccess}
        permission={selectedPermission}
        readOnly={isViewMode}
      />

      <ConfirmDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onConfirm={confirmBulkDelete}
        title="Delete Selected Permissions"
        description={`Are you sure you want to delete ${selectedIds.size} selected permissions? This action cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        loading={bulkDeleteLoading}
      />
    </PageContainer>
  );
}
