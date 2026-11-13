'use client';

import { useApi } from '../../hooks/use-api';
import { cn } from '../../lib/utils';
import { CheckCircle, Circle, Loader2 } from 'lucide-react';

interface WorkflowStep {
  id: string;
  state: string;
  label: string;
  sortOrder: number;
}

interface WorkflowProgressProps {
  processKey: string;
  currentState: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function WorkflowProgress({
  processKey,
  currentState,
  size = 'md',
  className,
}: WorkflowProgressProps) {
  const { data: steps, loading } = useApi<WorkflowStep[]>(
    `/workflow/processes/${processKey}/steps`,
  );

  if (loading || !steps) {
    return (
      <div className={cn('flex items-center gap-2 text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading workflow...</span>
      </div>
    );
  }

  const currentIndex = steps.findIndex((s) => s.state === currentState);

  const iconSize = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  const textSize = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-sm' : 'text-xs';
  const gapSize = size === 'sm' ? 'gap-1' : size === 'lg' ? 'gap-3' : 'gap-2';

  return (
    <div className={cn('flex items-center', gapSize, className)}>
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex items-center justify-center rounded-full',
                  isCompleted && 'text-green-600',
                  isCurrent && 'text-primary',
                  !isCompleted && !isCurrent && 'text-muted-foreground/40',
                )}
              >
                {isCompleted ? (
                  <CheckCircle className={iconSize} />
                ) : (
                  <Circle
                    className={cn(iconSize, isCurrent && 'fill-primary/20')}
                  />
                )}
              </div>
              {size !== 'sm' && (
                <span
                  className={cn(
                    textSize,
                    'mt-1 whitespace-nowrap',
                    isCompleted && 'text-green-600 font-medium',
                    isCurrent && 'text-primary font-semibold',
                    !isCompleted && !isCurrent && 'text-muted-foreground/60',
                  )}
                >
                  {step.label}
                </span>
              )}
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'mx-1 h-px w-6 flex-shrink-0',
                  size === 'lg' && 'w-10',
                  index < currentIndex ? 'bg-green-600' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
