'use client';

import { useState, useEffect } from 'react';
import {
  RefreshCw, X, ChevronDown, ChevronUp, FileText, Filter, Eye, Trash2, Download, ShieldCheck, ShieldAlert, MoreHorizontal
} from 'lucide-react';
import {
  API_URL, getAuthHeaders, apiClient, PageContainer, PageHeader, Pagination, PageInfo,
  SortableHeader, Button, Input, Label, Select, Dialog, cn, formatDateTime,
  Card, CardContent, CardFooter,
  useLanguage, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@saas/ui';
import { toast } from 'sonner';
import { ActionBadge } from './components/action-badge';

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  timestamp: string;
  user: { name: string; email: string } | null;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function AuditLogPage() {
  const { t } = useLanguage();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 10, pages: 0 });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filters, setFilters] = useState({
    entity: '',
    entityId: '',
    action: '',
    startDate: '',
    endDate: '',
  });
  const [debouncedFilters, setDebouncedFilters] = useState({
    entity: '',
    entityId: '',
  });

  // Mobile expand state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Export state
  const [exporting, setExporting] = useState(false);

  // Retention dialog state
  const [retentionDialogOpen, setRetentionDialogOpen] = useState(false);
  const [retentionType, setRetentionType] = useState<'time' | 'count'>('time');
  const [retentionDate, setRetentionDate] = useState('');
  const [retentionCount, setRetentionCount] = useState('1000');
  const [retentionBackup, setRetentionBackup] = useState(true);
  const [retentionLoading, setRetentionLoading] = useState(false);

  // Verify integrity state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    verified: boolean;
    checkedCount: number;
    firstEntry?: string;
    lastEntry?: string;
    brokenAt?: {
      id: string;
      timestamp: string;
      expectedHash: string;
      actualHash: string | null;
    };
  } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== debouncedSearch) {
        setDebouncedSearch(search);
        setMeta((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (filters.entity !== debouncedFilters.entity || filters.entityId !== debouncedFilters.entityId) {
        setDebouncedFilters({
          entity: filters.entity,
          entityId: filters.entityId,
        });
        setMeta((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [filters.entity, filters.entityId, debouncedFilters.entity, debouncedFilters.entityId]);

  useEffect(() => {
    fetchLogs();
  }, [meta.page, meta.limit, debouncedSearch, debouncedFilters, filters.action, filters.startDate, filters.endDate, sortBy, sortOrder]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ logs: AuditLog[]; pagination: Meta }>('/plugins/audit-log', {
        page: meta.page,
        limit: meta.limit,
        sortBy,
        sortOrder,
        ...(debouncedFilters.entity && { entity: debouncedFilters.entity }),
        ...(debouncedFilters.entityId && { entityId: debouncedFilters.entityId }),
        ...(filters.action && { action: filters.action }),
        ...(filters.startDate && { startDate: filters.startDate }),
        ...(filters.endDate && { endDate: filters.endDate }),
        ...(debouncedSearch && { search: debouncedSearch }),
      });

      setLogs(data.logs);
      setMeta({
        total: data.pagination.total,
        page: data.pagination.page,
        limit: data.pagination.limit,
        pages: data.pagination.pages,
      });
    } catch (error) {
      console.warn('Failed to fetch audit logs:', error);
      toast.error(t('auditLog.fetchError') || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
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

  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        format,
        ...(debouncedFilters.entity && { entity: debouncedFilters.entity }),
        ...(debouncedFilters.entityId && { entityId: debouncedFilters.entityId }),
        ...(filters.action && { action: filters.action }),
        ...(filters.startDate && { startDate: filters.startDate }),
        ...(filters.endDate && { endDate: filters.endDate }),
        ...(debouncedSearch && { search: debouncedSearch }),
        sortBy,
        sortOrder,
      });

      const response = await fetch(`${API_URL}/plugins/audit-log/export?${params}`, {
        headers: getAuthHeaders(),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs.${format === 'csv' ? 'csv' : 'json'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to export audit logs:', error);
      toast.error(t('auditLog.exportError') || 'Failed to export audit logs');
    } finally {
      setExporting(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const data = await apiClient.get<{
        verified: boolean;
        checkedCount: number;
        firstEntry?: string;
        lastEntry?: string;
        brokenAt?: { id: string; timestamp: string; expectedHash: string; actualHash: string | null };
      }>('/plugins/audit-log/verify');

      setVerifyResult(data);

      if (data.verified) {
        if (data.checkedCount === 0) {
          toast.info(t('auditLog.verifyNoLogs') || 'No audit logs to verify');
        } else {
          toast.success(`${t('auditLog.verifySuccess') || 'Integrity verified'} — ${data.checkedCount} ${t('auditLog.verifyChecked') || 'entries checked'}`);
        }
      } else {
        toast.error(t('auditLog.verifyFailed') || 'Integrity check failed');
      }
    } catch (error) {
      console.error('Failed to verify integrity:', error);
      toast.error(t('auditLog.verifyError') || 'Failed to verify integrity');
    } finally {
      setVerifying(false);
    }
  };

  const handleRetention = async () => {
    if (retentionType === 'time' && !retentionDate) {
      toast.error(t('auditLog.selectDate') || 'Please select a date');
      return;
    }

    if (retentionType === 'count' && (!retentionCount || parseInt(retentionCount) < 1)) {
      toast.error(t('auditLog.enterValidCount') || 'Please enter a valid record count');
      return;
    }

    setRetentionLoading(true);
    try {
      const data = await apiClient.post<{ message?: string; deleted?: number }>('/plugins/audit-log/retention', {
        type: retentionType,
        beforeDate: retentionType === 'time' ? retentionDate : undefined,
        keepCount: retentionType === 'count' ? parseInt(retentionCount) : undefined,
        backup: retentionBackup,
      });

      toast.success(data.message || `Successfully deleted ${data.deleted} audit log(s)`);
      setRetentionDialogOpen(false);
      fetchLogs();
    } catch (error) {
      console.error('Failed to apply retention:', error);
      toast.error(t('auditLog.retentionError') || 'Failed to apply retention policy');
    } finally {
      setRetentionLoading(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('auditLog.title') || 'Audit Logs'}
        description={t('auditLog.description') || 'View system activity and database changes'}
      >
        <div className="flex gap-2">
          <Button
            onClick={fetchLogs}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            {t('auditLog.refresh') || 'Refresh'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="primary" className="gap-2">
                <MoreHorizontal className="w-4 h-4" />
                {t('auditLog.actions') || 'Actions'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => handleExport('csv')}
                disabled={exporting}
              >
                <Download className="w-4 h-4 mr-2" />
                {exporting ? (t('auditLog.exporting') || 'Exporting...') : (t('auditLog.exportCsv') || 'Export CSV')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExport('json')}
                disabled={exporting}
              >
                <Download className="w-4 h-4 mr-2" />
                {exporting ? (t('auditLog.exporting') || 'Exporting...') : (t('auditLog.exportJson') || 'Export JSON')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleVerify}
                disabled={verifying}
              >
                <ShieldCheck className="w-4 h-4 mr-2" />
                {verifying
                  ? (t('auditLog.verifying') || 'Verifying...')
                  : (t('auditLog.verifyIntegrity') || 'Verify Integrity')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setRetentionDialogOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t('auditLog.retention') || 'Data Retention'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageHeader>

      {/* Verify Result Banner */}
      {verifyResult && (
        <div className={cn(
          "rounded-xl border p-4",
          verifyResult.verified
            ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
            : "bg-destructive/10 border-destructive/20",
        )}>
          <div className="flex items-start gap-3">
            {verifyResult.verified ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 space-y-1">
              <p className={cn(
                "text-sm font-medium",
                verifyResult.verified ? "text-emerald-700 dark:text-emerald-300" : "text-destructive",
              )}>
                {verifyResult.verified
                  ? `${t('auditLog.verifySuccess') || 'Integrity verified'} — ${verifyResult.checkedCount} ${t('auditLog.verifyChecked') || 'entries checked'}`
                  : (t('auditLog.verifyFailed') || 'Integrity check failed')}
              </p>
              {verifyResult.brokenAt && (
                <div className="text-xs text-destructive/80 space-y-0.5">
                  <p>{t('auditLog.verifyBrokenAt') || 'Chain broken at'}: {formatDateTime(verifyResult.brokenAt.timestamp)} (ID: {verifyResult.brokenAt.id})</p>
                  <p className="font-mono">{t('auditLog.verifyExpectedHash') || 'Expected hash'}: {verifyResult.brokenAt.expectedHash}</p>
                  <p className="font-mono">{t('auditLog.verifyActualHash') || 'Actual hash'}: {verifyResult.brokenAt.actualHash ?? '(null)'}</p>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setVerifyResult(null)}
              className="flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        {/* Header with Expand/Collapse */}
        <div className={`p-3 flex items-center justify-between border-border bg-muted/30 ${filtersExpanded ? 'border-b' : ''}`}>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Filters</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            className="gap-2"
          >
            {filtersExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Collapsible Content */}
        {filtersExpanded && (
          <div className="p-4 space-y-3">
            {/* Filters Grid - 2 Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('auditLog.entity') || 'Entity'}
                </Label>
                <Input
                  type="text"
                  placeholder={t('auditLog.filterByEntity') || 'Filter by entity'}
                  className="h-10"
                  value={filters.entity}
                  onChange={(e) => setFilters({ ...filters, entity: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('auditLog.entityId') || 'Entity ID'}
                </Label>
                <Input
                  type="text"
                  placeholder={t('auditLog.filterByEntityId') || 'Filter by entity ID'}
                  className="h-10"
                  value={filters.entityId}
                  onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('auditLog.user') || 'Username'}
                </Label>
                <Input
                  type="text"
                  placeholder={t('auditLog.search') || 'Search by username...'}
                  className="h-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('auditLog.action') || 'Action'}
                </Label>
                <Select
                  value={filters.action}
                  onChange={(value) => setFilters({ ...filters, action: value })}
                  options={[
                    { label: t('auditLog.allActions') || 'All Actions', value: '' },
                    { label: t('auditLog.create') || 'Create', value: 'CREATE' },
                    { label: t('auditLog.update') || 'Update', value: 'UPDATE' },
                    { label: t('auditLog.delete') || 'Delete', value: 'DELETE' },
                    { label: t('auditLog.read') || 'Read', value: 'READ' },
                  ]}
                  placeholder={t('auditLog.allActions') || 'All Actions'}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('auditLog.startDate') || 'Start Date'}
                </Label>
                <Input
                  type="date"
                  className="h-10"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('auditLog.endDate') || 'End Date'}
                </Label>
                <Input
                  type="date"
                  className="h-10"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table Card */}
      <Card className="overflow-hidden">
        <CardContent padded={false}>
        {/* Mobile List View */}
        <div className="md:hidden border-border">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="h-5 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-6 w-16 bg-muted animate-pulse rounded" />
                  </div>
                  <div className="h-4 w-full bg-muted animate-pulse rounded" />
                  <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <FileText className="h-8 w-8 opacity-50" />
                <p>{t('auditLog.noLogs') || 'No audit logs found'}</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {logs.map((log) => (
                <li key={log.id} className="bg-card transition-all duration-200 hover:bg-muted/50">
                  <div className="p-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <ActionBadge action={log.action} />
                        <button
                          type="button"
                          className="text-sm font-semibold text-foreground hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                          onClick={() => setSelectedLog(log)}
                        >
                          {log.entity}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">{log.user?.name || t('auditLog.system') || 'System'}</p>
                      <p className="text-xs text-muted-foreground mt-1">{formatDateTime(log.timestamp)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleExpand(log.id)}
                    >
                      {expandedIds.has(log.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>

                  {expandedIds.has(log.id) && (
                    <div className="px-4 pb-4 pt-0 bg-muted/20">
                      <div className="mt-3 space-y-3">
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('auditLog.entityId') || 'Entity ID'}</span>
                          <p className="text-xs mt-1 font-mono text-foreground">{log.entityId}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ID</span>
                          <p className="text-xs mt-1 font-mono text-muted-foreground">{log.id}</p>
                        </div>
                        {log.changes && Object.keys(log.changes).length > 0 && (
                          <div>
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('auditLog.changes') || 'Changes'}</span>
                            <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-x-auto">
                              {JSON.stringify(log.changes, null, 2)}
                            </pre>
                          </div>
                        )}
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
              <tr className="border-b border-border transition-colors">
                <th className="px-4 py-4 text-left align-middle font-medium text-muted-foreground">
                  <SortableHeader
                    field="timestamp"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  >
                    {t('auditLog.timestamp') || 'Timestamp'}
                  </SortableHeader>
                </th>
                <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                  {t('auditLog.user') || 'User'}
                </th>
                <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                  <SortableHeader
                    field="action"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  >
                    {t('auditLog.action') || 'Action'}
                  </SortableHeader>
                </th>
                <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                  <SortableHeader
                    field="entity"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  >
                    {t('auditLog.entity') || 'Entity'}
                  </SortableHeader>
                </th>
                <th className="px-4 py-3 text-left align-middle font-medium text-muted-foreground">
                  {t('auditLog.entityId') || 'Entity ID'}
                </th>
                <th className="px-4 py-3 text-right align-middle font-medium text-muted-foreground">
                  {t('auditLog.actions') || 'Actions'}
                </th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-6 w-16 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-48 bg-muted animate-pulse rounded" /></td>
                    <td className="px-4 py-3"><div className="h-8 w-20 bg-muted animate-pulse rounded" /></td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="h-8 w-8 opacity-50" />
                      <p>{t('auditLog.noLogs') || 'No audit logs found'}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-border bg-card transition-colors duration-50 hover:bg-muted/50 group">
                    <td className="px-4 py-3 align-middle text-sm text-muted-foreground">
                      {formatDateTime(log.timestamp)}
                    </td>
                    <td className="px-4 py-3 align-middle text-sm text-foreground">
                      {log.user?.name || t('auditLog.system') || 'System'}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-4 py-3 align-middle text-sm font-medium text-foreground">
                      <button
                        type="button"
                        className="hover:underline hover:text-primary transition-colors text-left cursor-pointer"
                        onClick={() => setSelectedLog(log)}
                      >
                        {log.entity}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-middle text-xs font-mono text-muted-foreground">{log.entityId}</td>
                    <td className="px-4 py-3 align-middle text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedLog(log)}
                        className="gap-2"
                      >
                        <Eye className="h-4 w-4" />
                        {t('auditLog.view') || 'View'}
                      </Button>
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
            totalPages={meta.pages}
            onPageChange={(page) => setMeta({ ...meta, page })}
          />
        </CardFooter>
      </Card>

      {/* Detail Modal */}
      <Dialog
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title={t('auditLog.details') || 'Audit Log Details'}
        size="2xl"
        closeText={t('auditLog.close') || 'Close'}
      >
        {selectedLog && (
          <div className="space-y-6">
            {/* Metadata Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('auditLog.timestamp') || 'Timestamp'}
                </Label>
                <p className="mt-1 text-sm text-foreground">{formatDateTime(selectedLog.timestamp)}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('auditLog.user') || 'User'}
                </Label>
                <p className="mt-1 text-sm text-foreground">{selectedLog.user?.name || t('auditLog.system') || 'System'}</p>
                {selectedLog.user?.email && (
                  <p className="text-xs text-muted-foreground">{selectedLog.user.email}</p>
                )}
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('auditLog.action') || 'Action'}
                </Label>
                <div className="mt-1">
                  <ActionBadge action={selectedLog.action} />
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('auditLog.entity') || 'Entity'}
                </Label>
                <p className="mt-1 text-sm text-foreground">{selectedLog.entity}</p>
              </div>
              <div className="col-span-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('auditLog.entityId') || 'Entity ID'}
                </Label>
                <p className="mt-1 text-xs font-mono text-foreground bg-muted px-2 py-1 rounded">{selectedLog.entityId}</p>
              </div>
            </div>

            {/* Changes Section */}
            {selectedLog.changes && Object.keys(selectedLog.changes).length > 0 && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('auditLog.changes') || 'Changes'}
                </Label>
                <div className="mt-2 max-h-96 overflow-auto border border-border rounded-lg bg-muted">
                  <pre className="p-4 text-xs font-mono">
                    {JSON.stringify(selectedLog.changes, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Metadata Section */}
            {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('auditLog.metadata') || 'Metadata'}
                </Label>
                <div className="mt-2 max-h-96 overflow-auto border border-border rounded-lg bg-muted">
                  <pre className="p-4 text-xs font-mono">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Retention Dialog */}
      <Dialog
        isOpen={retentionDialogOpen}
        onClose={() => setRetentionDialogOpen(false)}
        title={t('auditLog.dataRetention') || 'Data Retention'}
        showFooter={false}
        size="lg"
      >
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {t('auditLog.retentionDescription') || 'Clear old audit logs to manage storage. Choose to delete by date or keep only recent records.'}
          </p>

          {/* Retention Type Selection */}
          <div className="space-y-3">
            <Label>
              {t('auditLog.retentionType') || 'Retention Type'}
            </Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="retentionType"
                  value="time"
                  checked={retentionType === 'time'}
                  onChange={(e) => setRetentionType(e.target.value as 'time' | 'count')}
                  className="w-4 h-4 text-primary focus:ring-primary"
                />
                <span className="text-sm">{t('auditLog.byDate') || 'By Date'}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="retentionType"
                  value="count"
                  checked={retentionType === 'count'}
                  onChange={(e) => setRetentionType(e.target.value as 'time' | 'count')}
                  className="w-4 h-4 text-primary focus:ring-primary"
                />
                <span className="text-sm">{t('auditLog.byCount') || 'By Record Count'}</span>
              </label>
            </div>
          </div>

          {/* Conditional Fields */}
          {retentionType === 'time' ? (
            <div className="space-y-2">
              <Label>
                {t('auditLog.deleteOlderThan') || 'Delete logs older than'}
              </Label>
              <Input
                type="date"
                value={retentionDate}
                onChange={(e) => setRetentionDate(e.target.value)}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                {t('auditLog.dateHelp') || 'All audit logs before this date will be permanently deleted.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>
                {t('auditLog.keepRecentRecords') || 'Keep most recent records'}
              </Label>
              <Input
                type="number"
                min="1"
                value={retentionCount}
                onChange={(e) => setRetentionCount(e.target.value)}
                placeholder="1000"
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                {t('auditLog.countHelp') || 'Only the specified number of most recent logs will be kept. Older logs will be deleted.'}
              </p>
            </div>
          )}

          {/* Backup Option */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={retentionBackup}
                onChange={(e) => setRetentionBackup(e.target.checked)}
                className="w-4 h-4 text-primary focus:ring-primary rounded border-border"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  {t('auditLog.backupBeforeDelete') || 'Backup logs before deletion'}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('auditLog.backupHelp') || 'Deleted logs will be saved to a JSON file in the backups directory.'}
                </p>
              </div>
            </label>
          </div>

          {/* Warning Banner */}
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <div className="flex gap-3">
              <Trash2 className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">
                  {t('auditLog.warningTitle') || 'Warning: This action cannot be undone'}
                </p>
                <p className="text-xs text-destructive/80">
                  {t('auditLog.warningMessage') || 'Deleted audit logs cannot be recovered. Make sure you have backups if needed.'}
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button
              variant="outline"
              onClick={() => setRetentionDialogOpen(false)}
              disabled={retentionLoading}
            >
              {t('auditLog.cancel') || 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRetention}
              isLoading={retentionLoading}
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {t('auditLog.applyRetention') || 'Apply Retention'}
            </Button>
          </div>
        </div>
      </Dialog>
    </PageContainer>
  );
}
