'use client';

import { useApi } from '../../hooks/use-api';
import { cn } from '../../lib/utils';
import { formatDateTime } from '../../lib/date-format';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Badge } from '../badge';

interface WorkflowTransition {
  id: string;
  processKey: string;
  entityType: string;
  entityId: string;
  fromState: string;
  toState: string;
  action: string;
  userId: string;
  comment?: string;
  createdAt: string;
}

interface WorkflowTimelineProps {
  processKey: string;
  entityId: string;
  className?: string;
}

function actionVariant(action: string) {
  switch (action) {
    case 'advance':
      return 'default' as const;
    case 'reject':
      return 'destructive' as const;
    case 'cancel':
      return 'warning' as const;
    case 'revert':
      return 'outline' as const;
    default:
      return 'outline' as const;
  }
}

export function WorkflowTimeline({
  processKey,
  entityId,
  className,
}: WorkflowTimelineProps) {
  const { data: transitions, loading } = useApi<WorkflowTransition[]>(
    `/workflow/transitions/${processKey}/${entityId}`,
  );

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 text-muted-foreground py-4', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading history...</span>
      </div>
    );
  }

  if (!transitions || transitions.length === 0) {
    return (
      <div className={cn('text-sm text-muted-foreground py-4', className)}>
        No transition history yet.
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {transitions.map((t, index) => (
        <div
          key={t.id}
          className={cn(
            'relative pl-6 pb-3',
            index < transitions.length - 1 && 'border-l border-border ml-2',
          )}
        >
          <div className="absolute -left-1 top-1 h-2.5 w-2.5 rounded-full bg-primary" />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{t.fromState}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm font-medium">{t.toState}</span>
            <Badge variant={actionVariant(t.action)} className="text-xs">
              {t.action}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(t.createdAt)}
          </div>
          {t.comment && (
            <div className="mt-1 text-sm text-muted-foreground italic">
              &ldquo;{t.comment}&rdquo;
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
