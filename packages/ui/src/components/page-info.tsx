import { cn } from '../lib/utils';

interface PageInfoProps {
  currentPage: number;
  limit: number;
  total: number;
  className?: string;
}

export function PageInfo({ currentPage, limit, total, className }: PageInfoProps) {
  if (total === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        No entries found
      </div>
    );
  }

  const start = (currentPage - 1) * limit + 1;
  const end = Math.min(currentPage * limit, total);

  return (
    <div className={cn("text-sm text-muted-foreground", className)}>
      Showing <span className="font-medium text-foreground">{start}</span> to <span className="font-medium text-foreground">{end}</span> of <span className="font-medium text-foreground">{total}</span> entries
    </div>
  );
}
