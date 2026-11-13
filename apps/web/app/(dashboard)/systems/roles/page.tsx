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
  ListPageSkeleton, SkeletonTable, EmptyState, ErrorAlert, Badge,
  Card, CardHeader, CardContent, CardFooter,
  usePaginatedApi, apiClient, ApiRequestError,
  formatDate, formatDateTime,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';
import { RoleDialog } from './role-dialog';

interface Permission {
  id: string;
  name: string;
  description: string;
}

interface Role {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  permissions: Permission[];
  _count?: {
    users: number;
    permissions: number;
  };
}

export default function RolesPage() {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const storedTenantName = useAuthStore(s => s.tenantName);

  // Search, sort, pagination state
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  // Data fetching via hook
  const { data: roles, meta, loading, error, refetch } = usePaginatedApi<Role>(
    '/system/roles',
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
  const [roleToDelete, setRoleToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // Create/Edit dialog state
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);

  // Mobile expand state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  useEffect(() => {
    document.title = `Roles | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  if (isRBACLoading) {
    return <PageContainer><ListPageSkeleton /></PageContainer>;
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['system.role.read']})) {
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
    setRoleToDelete(id);
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
    setSelectedRole(null);
    setIsReadOnly(false);
    setRoleDialogOpen(true);
  };

  const handleEdit = (role: Role) => {
    setSelectedRole(role);
    setIsReadOnly(false);
    setRoleDialogOpen(true);
  };

  const handleView = (role: Role) => {
    setSelectedRole(role);
    setIsReadOnly(true);
    setRoleDialogOpen(true);
  };

  const handleSuccess = () => {
    refetch();
  };

  const confirmExport = async () => {
    setExportLoading(true);
    try {
      const csvData = await apiClient.get<string>('/system/roles/export', {
        sortBy,
        sortOrder,
        search: search || undefined,
      });

      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'roles.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Roles exported successfully');
      setExportDialogOpen(false);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'An error occurred while exporting roles';
      toast.error(message);
    } finally {
      setExportLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!roleToDelete) return;

    setDeleteLoading(true);
    try {
      await apiClient.delete(`/system/roles/${roleToDelete}`);
      setDeleteDialogOpen(false);
      setRoleToDelete(null);
      refetch();
      toast.success('Role deleted successfully');
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'An error occurred while deleting role';
      toast.error(message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSelected = new Set(selectedIds);
      roles.forEach((p) => {
        if (p.name.toUpperCase() !== 'SYSADMIN') {
          newSelected.add(p.id);
        }
      });
      setSelectedIds(newSelected);
    } else {
      const newSelected = new Set(selectedIds);
      roles.forEach((p) => newSelected.delete(p.id));
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
      await apiClient.post('/system/roles/bulk-delete', { ids: Array.from(selectedIds) });
      setBulkDeleteDialogOpen(false);
      setSelectedIds(new Set());
      refetch();
      toast.success('Selected roles deleted successfully');
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'An error occurred while deleting roles';
      toast.error(message);
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Roles"
        description="Manage system roles and their permissions."
      >
        <Protect roles={['ADMIN']} permissions={['system.role.read']}>
          <Button
            onClick={refetch}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </Protect>
        <Protect roles={['ADMIN']} permissions={['system.role.write']}>
          <Button
            onClick={handleCreate}
            className="gap-2"
          >
            <Plus className="w-4 h-4" /> Create Role
          </Button>
        </Protect>
      </PageHeader>

      <Card className="overflow-hidden">
        <CardHeader
          className="p-4"
          toolbar={
            <div className="hidden sm:flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Protect roles={['ADMIN']} permissions={['system.role.write']}>
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
              <Protect roles={['ADMIN']} permissions={['system.role.read']}>
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
                placeholder="Search roles..."
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
            <Protect roles={['ADMIN']} permissions={['system.role.read']}>
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
          ) : roles.length === 0 ? (
            <EmptyState
              icon={<Search className="h-8 w-8" />}
              title="No roles found"
              description="No roles found matching your criteria."
            />
          ) : (
            <ul className="divide-y divide-border">
              {roles.map((role) => (
                <li key={role.id} className="bg-card transition-all duration-200 hover:bg-muted/50">
                  <div className="p-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          type="button"
                          className="font-semibold text-foreground truncate hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                          onClick={() => handleView(role)}
                        >
                          {role.name}
                        </button>
                        <Badge variant="outline">
                          {role._count?.permissions || role.permissions?.length || 0} perms
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{role.description}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Protect roles={['ADMIN']} permissions={['system.role.write']}>
                        {role.name.toUpperCase() !== 'SYSADMIN' && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(role)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(role.id)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </Protect>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleExpand(role.id)}
                      >
                        {expandedIds.has(role.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  {expandedIds.has(role.id) && (
                    <div className="px-4 pb-4 pt-0 bg-muted/20">
                      <div className="mt-3 space-y-3">
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</span>
                          <p className="text-sm mt-1 text-foreground">{role.description}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Permissions</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {role.permissions?.length > 0 ? (
                              role.permissions.map(p => (
                                <Badge key={p.id} variant="outline">{p.name}</Badge>
                              ))
                            ) : (
                              <span className="text-sm text-muted-foreground">No permissions assigned</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Created At</span>
                          <p className="text-sm mt-1 text-foreground">{formatDateTime(role.createdAt)}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ID</span>
                          <p className="text-xs mt-1 font-mono text-muted-foreground">{role.id}</p>
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
                    checked={roles.length > 0 && roles.filter(r => r.name.toUpperCase() !== 'SYSADMIN').every(p => selectedIds.has(p.id))}
                    indeterminate={roles.filter(r => r.name.toUpperCase() !== 'SYSADMIN').some(p => selectedIds.has(p.id)) && !roles.filter(r => r.name.toUpperCase() !== 'SYSADMIN').every(p => selectedIds.has(p.id))}
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
                  Permissions
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
                    <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-8 w-8 bg-muted animate-pulse rounded ml-auto" /></td>
                  </tr>
                ))
              ) : roles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={<Search className="h-8 w-8" />}
                      title="No roles found"
                      description="No roles found matching your criteria."
                    />
                  </td>
                </tr>
              ) : (
                roles.map((role) => (
                  <tr key={role.id} className="border-b border-border bg-card transition-colors duration-50 hover:bg-muted/50 data-[state=selected]:bg-muted group">
                    <td className="px-4 py-3 align-middle">
                       <Checkbox
                          checked={selectedIds.has(role.id)}
                          onChange={(e) => handleSelectOne(role.id, e.target.checked)}
                          disabled={role.name.toUpperCase() === 'SYSADMIN'}
                        />
                    </td>
                    <td className="px-4 py-3 align-middle text-md font-medium text-foreground">
                      <button
                        type="button"
                        className="hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                        onClick={() => handleView(role)}
                      >
                        {role.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground max-w-xs truncate" title={role.description}>{role.description}</td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {role._count?.permissions || role.permissions?.length || 0}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {role.permissions?.map(p => p.name).join(', ')}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">{formatDate(role.createdAt)}</td>
                    <td className="px-4 py-3 align-middle text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleView(role)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View
                          </DropdownMenuItem>
                          {role.name.toUpperCase() !== 'SYSADMIN' && (
                            <Protect roles={['ADMIN']} permissions={['system.role.write']}>
                              <DropdownMenuItem onClick={() => handleEdit(role)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => handleDelete(role.id)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </Protect>
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
        title="Delete Role"
        description="Are you sure you want to delete this role? This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        loading={deleteLoading}
      />

      <ConfirmDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onConfirm={confirmExport}
        title="Export Roles"
        description="Are you sure you want to export the roles list to a CSV file?"
        confirmText="Export"
        loading={exportLoading}
      />

      <RoleDialog
        isOpen={roleDialogOpen}
        onClose={() => setRoleDialogOpen(false)}
        onSuccess={handleSuccess}
        role={selectedRole}
        readOnly={isReadOnly}
      />

      <ConfirmDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onConfirm={confirmBulkDelete}
        title="Delete Selected Roles"
        description={`Are you sure you want to delete ${selectedIds.size} selected roles? This action cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        loading={bulkDeleteLoading}
      />
    </PageContainer>
  );
}
