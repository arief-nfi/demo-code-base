import { cn } from '@saas/ui';

interface ActionBadgeProps {
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'READ' | string;
  className?: string;
}

const actionStyles = {
  CREATE: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400 border-green-200 dark:border-green-800',
  UPDATE: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  DELETE: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400 border-red-200 dark:border-red-800',
  READ: 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400 border-gray-200 dark:border-gray-800',
};

export function ActionBadge({ action, className }: ActionBadgeProps) {
  const styles = actionStyles[action as keyof typeof actionStyles] || actionStyles.READ;
  
  return (
    <span className={cn('px-2 py-1 rounded text-xs font-medium border', styles, className)}>
      {action}
    </span>
  );
}
