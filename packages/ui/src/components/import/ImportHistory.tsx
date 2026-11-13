'use client';

import { useState } from 'react';
import { usePaginatedApi } from '../../hooks/use-api';
import { cn } from '../../lib/utils';
import { formatDateTime } from '../../lib/date-format';
import { Badge } from '../badge';
import { Pagination } from '../pagination';
import { EmptyState } from '../empty-state';
import { Skeleton } from '../skeleton';
import { FileSpreadsheet } from 'lucide-react';

interface ImportJob {
  id: string;
  importKey: string;
  fileName: string;
  status: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  createdAt: string;
  completedAt?: string;
}

interface ImportHistoryProps {
  importKey?: string;
  className?: string;
}

function statusVariant(status: string) {
  switch (status) {
    case 'COMPLETED': return 'success' as const;
    case 'FAILED': return 'destructive' as const;
    case 'IMPORTING': return 'default' as const;
    case 'CANCELLED': return 'warning' as const;
    default: return 'outline' as const;
  }
}

export function ImportHistory({ importKey, className }: ImportHistoryProps) {
  const [page, setPage] = useState(1);
  const endpoint = importKey ? `/imports/jobs?importKey=${importKey}` : '/imports/jobs';
  const { data: jobs, meta, loading } = usePaginatedApi<ImportJob>(
    endpoint,
    { page, limit: 10 },
  );

  if (loading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
      </div>
    );
  }

  if (!jobs || jobs.length === 0) {
    return (
      <EmptyState
        icon={<FileSpreadsheet className="h-8 w-8" />}
        title="No import history"
        description="Import history will appear here after you run your first import."
      />
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex items-center justify-between rounded-md border border-border px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{job.fileName}</span>
                <Badge variant={statusVariant(job.status)} className="text-xs">
                  {job.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {formatDateTime(job.createdAt)} — {job.importedRows} imported, {job.skippedRows} skipped, {job.failedRows} failed of {job.totalRows}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {job.importKey}
          </div>
        </div>
      ))}

      {meta && meta.totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={meta.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
