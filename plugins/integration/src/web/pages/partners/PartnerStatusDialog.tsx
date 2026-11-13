'use client';

import { useState } from 'react';
import {
  Button, apiClient,
  DialogRoot, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  useLanguage,
} from '@saas/ui';
import { toast } from 'sonner';

interface Partner {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

interface PartnerStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  partner?: Partner | null;
}

const STATUSES: Array<{ value: Partner['status']; labelKey: string; color: string }> = [
  { value: 'ACTIVE', labelKey: 'integration.partners.statusActive', color: 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400' },
  { value: 'INACTIVE', labelKey: 'integration.partners.statusInactive', color: 'border-gray-500 bg-gray-500/10 text-gray-700 dark:text-gray-400' },
  { value: 'SUSPENDED', labelKey: 'integration.partners.statusSuspended', color: 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400' },
];

export function PartnerStatusDialog({
  isOpen,
  onClose,
  onSuccess,
  partner,
}: PartnerStatusDialogProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<Partner['status'] | null>(null);
  const [loading, setLoading] = useState(false);

  const currentStatus = selected ?? partner?.status ?? 'ACTIVE';

  const handleConfirm = async () => {
    if (!partner || !selected || selected === partner.status) return;
    setLoading(true);
    try {
      await apiClient.patch(`/plugins/integration/partners/${partner.id}/status`, { status: selected });
      toast.success(t('integration.partners.statusUpdateSuccess'));
      onSuccess();
      onClose();
      setSelected(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('integration.partners.saveError');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setSelected(null);
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('integration.partners.confirmStatusChange')}</DialogTitle>
          <DialogDescription>
            {t('integration.partners.confirmStatusChangeMessage', {
              name: partner?.name ?? '',
              status: selected ? t(`integration.partners.status${selected.charAt(0)}${selected.slice(1).toLowerCase()}`) : '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 space-y-2">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSelected(s.value)}
              className={`w-full flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors ${
                currentStatus === s.value
                  ? s.color
                  : 'border-border hover:bg-muted/50'
              }`}
            >
              <div
                className={`h-3 w-3 rounded-full ${
                  currentStatus === s.value ? 'bg-current' : 'bg-muted-foreground/30'
                }`}
              />
              <span className="text-sm font-medium">{t(s.labelKey)}</span>
            </button>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClose();
              setSelected(null);
            }}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !selected || selected === partner?.status}
            isLoading={loading}
          >
            {t('integration.partners.changeStatus')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
