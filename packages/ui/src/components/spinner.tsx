import { cn } from '../lib/utils';

interface SpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Wrap in a full-height centered container */
  fullPage?: boolean;
}

const sizeMap = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-4',
  lg: 'h-12 w-12 border-4',
};

export function Spinner({ className, size = 'md', fullPage }: SpinnerProps) {
  const spinner = (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        'animate-spin rounded-full border-primary border-t-transparent',
        sizeMap[size],
        className,
      )}
    >
      <span className="sr-only">Loading...</span>
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        {spinner}
      </div>
    );
  }

  return spinner;
}
