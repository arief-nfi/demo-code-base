'use client';

import {
  Button, cn,
  DialogRoot, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  useLanguage, formatDateTime,
} from '@saas/ui';

interface Delivery {
  id: string;
  eventCode: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING';
  httpStatus?: number | null;
  attempt: number;
  duration?: number | null;
  payload?: unknown | null;
  responseBody?: string | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
  nextRetryAt?: string | null;
}

interface DeliveryDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  delivery?: Delivery | null;
}

export function DeliveryDetailDialog({ isOpen, onClose, delivery }: DeliveryDetailDialogProps) {
  const { t } = useLanguage();

  if (!delivery) return null;

  const statusStyles: Record<string, string> = {
    PENDING: 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400',
    SUCCESS: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
    FAILED: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
    RETRYING: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  };

  const statusLabelKeys: Record<string, string> = {
    PENDING: 'integration.webhooks.deliveries.statusPending',
    SUCCESS: 'integration.webhooks.deliveries.statusSuccess',
    FAILED: 'integration.webhooks.deliveries.statusFailed',
    RETRYING: 'integration.webhooks.deliveries.statusRetrying',
  };

  const formatJson = (data: unknown): string => {
    if (!data) return '';
    if (typeof data === 'string') {
      try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; }
    }
    return JSON.stringify(data, null, 2);
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('integration.webhooks.deliveries.viewDetails')}</DialogTitle>
          <DialogDescription>{delivery.eventCode} — #{delivery.attempt}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 max-h-[60vh] overflow-y-auto">
          {/* Status row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.status')}</span>
              <p className="mt-1">
                <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium border', statusStyles[delivery.status])}>
                  {t(statusLabelKeys[delivery.status])}
                </span>
              </p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.httpStatus')}</span>
              <p className="text-sm mt-1 text-foreground">{delivery.httpStatus ?? '-'}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.attempt')}</span>
              <p className="text-sm mt-1 text-foreground">{delivery.attempt}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.duration')}</span>
              <p className="text-sm mt-1 text-foreground">
                {delivery.duration != null ? `${delivery.duration}ms` : '-'}
              </p>
            </div>
          </div>

          {/* Timestamps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.createdAt')}</span>
              <p className="text-sm mt-1 text-foreground">{formatDateTime(delivery.createdAt)}</p>
            </div>
            {delivery.completedAt && (
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.completedAt')}</span>
                <p className="text-sm mt-1 text-foreground">{formatDateTime(delivery.completedAt)}</p>
              </div>
            )}
            {delivery.nextRetryAt && (
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.nextRetryAt')}</span>
                <p className="text-sm mt-1 text-foreground">{formatDateTime(delivery.nextRetryAt)}</p>
              </div>
            )}
          </div>

          {/* Error */}
          {delivery.error && (
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.error')}</span>
              <pre className="mt-1 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm font-mono text-red-700 dark:text-red-400 overflow-auto max-h-32">
                {delivery.error}
              </pre>
            </div>
          )}

          {/* Payload */}
          {delivery.payload && (
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.payload')}</span>
              <pre className="mt-1 rounded-md border bg-muted/30 p-3 text-sm font-mono overflow-auto max-h-48 text-foreground">
                {formatJson(delivery.payload)}
              </pre>
            </div>
          )}

          {/* Response Body */}
          {delivery.responseBody && (
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('integration.webhooks.deliveries.responseBody')}</span>
              <pre className="mt-1 rounded-md border bg-muted/30 p-3 text-sm font-mono overflow-auto max-h-48 text-foreground">
                {formatJson(delivery.responseBody)}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
