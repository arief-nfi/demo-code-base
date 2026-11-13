import { cn } from '../lib/utils';

interface ErrorAlertProps {
  message: string;
  className?: string;
  onRetry?: () => void;
}

export function ErrorAlert({ message, className, onRetry }: ErrorAlertProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive',
        className,
      )}
      role="alert"
    >
      <div className="flex items-center justify-between">
        <span>{message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-4 text-sm font-medium underline hover:no-underline"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
