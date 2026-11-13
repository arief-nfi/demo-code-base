import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface StatsCardProps {
  icon?: ReactNode;
  label: string;
  value: string | number;
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    value: string;
    period?: string;
  };
  className?: string;
}

export function StatsCard({ icon, label, value, trend, className }: StatsCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {trend && (
          <span
            className={cn(
              'text-xs font-medium',
              trend.direction === 'up' && 'text-success',
              trend.direction === 'down' && 'text-destructive',
              trend.direction === 'neutral' && 'text-muted-foreground',
            )}
          >
            {trend.direction === 'up' && '+'}
            {trend.value}
            {trend.period && (
              <span className="ml-1 text-muted-foreground">{trend.period}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
