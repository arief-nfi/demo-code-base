'use client';

import { useApi } from '../../hooks/use-api';
import { cn } from '../../lib/utils';
import { apiClient } from '../../lib/api-client';
import { Switch } from '../switch';
import { Badge } from '../badge';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface WorkflowStep {
  id: string;
  state: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isMandatory: boolean;
  permissions: string[];
}

interface WorkflowProcess {
  id: string;
  pluginKey: string;
  processKey: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

interface WorkflowStepManagerProps {
  processKey: string;
  className?: string;
}

export function WorkflowStepManager({
  processKey,
  className,
}: WorkflowStepManagerProps) {
  const { data: process, loading, refetch } = useApi<WorkflowProcess>(
    `/workflow/processes/${processKey}`,
  );

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 text-muted-foreground py-4', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading workflow steps...</span>
      </div>
    );
  }

  if (!process) {
    return (
      <div className={cn('text-sm text-muted-foreground py-4', className)}>
        Workflow not found.
      </div>
    );
  }

  async function handleToggle(stepId: string, isActive: boolean, label: string) {
    try {
      await apiClient.patch(`/workflow/steps/${stepId}`, { isActive });
      toast.success(`Step "${label}" ${isActive ? 'enabled' : 'disabled'}`);
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update step');
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      {process.steps.map((step, index) => (
        <div
          key={step.id}
          className={cn(
            'flex items-center justify-between rounded-md border border-border px-4 py-3',
            !step.isActive && 'opacity-50 bg-muted/30',
          )}
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground w-6">
              {index + 1}.
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className={cn('text-sm font-medium', !step.isActive && 'line-through')}>
                  {step.label}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {step.state}
                </span>
                {step.isMandatory && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Lock className="h-3 w-3" />
                    Required
                  </Badge>
                )}
              </div>
              {step.permissions.length > 0 && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Requires: {step.permissions.join(', ')}
                </div>
              )}
            </div>
          </div>
          <Switch
            checked={step.isActive}
            onCheckedChange={(checked: boolean) =>
              handleToggle(step.id, checked, step.label)
            }
            disabled={step.isMandatory}
            aria-label={`Toggle ${step.label}`}
          />
        </div>
      ))}
    </div>
  );
}
