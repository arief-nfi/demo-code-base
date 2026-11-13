// plugins/sample-plugin/src/web/pages/sample-articles/DeleteSampleArticleDialog.tsx
'use client';

import { useState } from 'react';
import { apiClient, ConfirmDialog, useLanguage } from '@saas/ui';
import { toast } from 'sonner';

export type DeleteSampleArticleTarget =
  | { kind: 'single'; id: string }
  | { kind: 'bulk'; ids: string[] };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  target: DeleteSampleArticleTarget | null;
}

export function DeleteSampleArticleDialog({ isOpen, onClose, onSuccess, target }: Props) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);

  const isBulk = target?.kind === 'bulk';

  const handleConfirm = async () => {
    if (!target) return;
    setLoading(true);
    try {
      if (target.kind === 'single') {
        await apiClient.delete(`/plugins/sample-plugin/articles/${target.id}`);
        toast.success(t('samplePlugin.articles.confirmDelete.success'));
      } else {
        await apiClient.post('/plugins/sample-plugin/articles/bulk-delete', { ids: target.ids });
        toast.success(t('samplePlugin.articles.confirmDelete.bulkSuccess'));
      }
      onSuccess();
      onClose();
    } catch {
      toast.error(t('samplePlugin.articles.confirmDelete.error'));
    } finally {
      setLoading(false);
    }
  };

  const title = isBulk
    ? t('samplePlugin.articles.confirmDelete.titleBulk')
    : t('samplePlugin.articles.confirmDelete.title');

  const description = isBulk
    ? t('samplePlugin.articles.confirmDelete.messageBulk', {
        count: (target as { kind: 'bulk'; ids: string[] } | null)?.ids.length ?? 0,
      })
    : t('samplePlugin.articles.confirmDelete.messageSingle');

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title={title}
      description={description}
      confirmText={t('samplePlugin.articles.confirmDelete.confirm')}
      variant="destructive"
      loading={loading}
    />
  );
}
