'use client';

import {
  Button,
  DialogRoot, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  useLanguage,
} from '@saas/ui';
import { useState } from 'react';

interface RevokeConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  mode: 'revoke' | 'regenerate';
}

export function RevokeConfirmDialog({ isOpen, onClose, onConfirm, mode }: RevokeConfirmDialogProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'revoke'
    ? t('integration.apiKeys.confirmRevoke')
    : t('integration.apiKeys.confirmRegenerate');

  const message = mode === 'revoke'
    ? t('integration.apiKeys.confirmRevokeMessage')
    : t('integration.apiKeys.confirmRegenerateMessage');

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
            isLoading={loading}
          >
            {mode === 'revoke' ? t('integration.apiKeys.revoke') : t('integration.apiKeys.regenerate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
