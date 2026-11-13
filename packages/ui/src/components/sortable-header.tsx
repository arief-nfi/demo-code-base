import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown } from 'lucide-react';
import { cn } from '../lib/utils';

interface SortableHeaderProps {
  children: React.ReactNode;
  field: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (field: string) => void;
  className?: string;
}

export function SortableHeader({
  children,
  field,
  sortBy,
  sortOrder,
  onSort,
  className,
}: SortableHeaderProps) {
  const isSorted = sortBy === field;

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn("flex items-center gap-2 hover:text-foreground transition-colors cursor-pointer", className)}
      aria-sort={isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
      aria-label={`Sort by ${typeof children === 'string' ? children : field}`}
    >
      {children}
      {isSorted ? (
        sortOrder === 'asc' ? (
          <ArrowDownAZ className="w-3 h-3" />
        ) : (
          <ArrowUpAZ className="w-3 h-3" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-50" />
      )}
    </button>
  );
}
