'use client';

import { useEffect } from 'react';
import {
  Button, Input, Select, apiClient,
  DialogRoot, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  useLanguage,
} from '@saas/ui';
import { toast } from 'sonner';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface ApiKey {
  id: string;
  partnerId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  partner?: { id: string; code: string; name: string };
}

interface Partner {
  id: string;
  name: string;
  code: string;
}

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (rawKey?: string) => void;
  apiKey?: ApiKey | null;
  readOnly?: boolean;
  partners: Partner[];
}

const SCOPE_OPTIONS = [
  { label: 'All scopes (*)', value: '*' },
  { label: 'Trigger webhooks', value: 'webhook.trigger' },
];

const apiKeyFormSchema = z.object({
  partnerId: z.string().min(1, 'Partner is required'),
  name: z.string().min(1, 'Name is required').max(255),
  scopes: z.string(),
  expiresAt: z.string().optional(),
});

type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;

export function ApiKeyDialog({
  isOpen,
  onClose,
  onSuccess,
  apiKey,
  readOnly = false,
  partners,
}: ApiKeyDialogProps) {
  const { t } = useLanguage();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeyFormSchema) as any,
    defaultValues: {
      partnerId: '',
      name: '',
      scopes: '*',
      expiresAt: '',
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (apiKey) {
        reset({
          partnerId: apiKey.partnerId,
          name: apiKey.name,
          scopes: Array.isArray(apiKey.scopes) ? apiKey.scopes.join(', ') : '*',
          expiresAt: apiKey.expiresAt ? apiKey.expiresAt.split('T')[0] : '',
        });
      } else {
        reset({
          partnerId: '',
          name: '',
          scopes: '*',
          expiresAt: '',
        });
      }
    }
  }, [isOpen, apiKey, reset]);

  const onSubmit = async (data: ApiKeyFormValues) => {
    try {
      const scopes = data.scopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: Record<string, unknown> = {
        name: data.name,
        scopes,
      };

      if (data.expiresAt) {
        payload.expiresAt = new Date(data.expiresAt).toISOString();
      } else if (apiKey) {
        payload.expiresAt = null;
      }

      if (apiKey) {
        await apiClient.patch(`/plugins/integration/api-keys/${apiKey.id}`, payload);
        toast.success(t('integration.apiKeys.updateSuccess'));
        onSuccess();
      } else {
        payload.partnerId = data.partnerId;
        const result = await apiClient.post<{ apiKey: ApiKey; rawKey: string }>(
          '/plugins/integration/api-keys',
          payload,
        );
        toast.success(t('integration.apiKeys.createSuccess'));
        onSuccess(result.rawKey);
      }
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('integration.apiKeys.saveError');
      toast.error(message);
    }
  };

  const partnerOptions = partners.map((p) => ({ label: p.name, value: p.id }));

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {readOnly
              ? t('integration.apiKeys.view')
              : apiKey
                ? t('integration.apiKeys.edit')
                : t('integration.apiKeys.create')}
          </DialogTitle>
          <DialogDescription>
            {t('integration.apiKeys.description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.apiKeys.partner')} <span className="text-red-500">*</span>
            </label>
            <Controller
              name="partnerId"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onChange={field.onChange}
                  options={partnerOptions}
                  placeholder={t('integration.apiKeys.selectPartner')}
                  disabled={readOnly || isSubmitting || !!apiKey}
                  error={!!errors.partnerId}
                />
              )}
            />
            {errors.partnerId && (
              <p className="text-sm text-red-500">{errors.partnerId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.apiKeys.name')} <span className="text-red-500">*</span>
            </label>
            <Input
              error={!!errors.name}
              {...register('name')}
              placeholder={t('integration.apiKeys.namePlaceholder')}
              disabled={readOnly || isSubmitting}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.apiKeys.scopes')}
            </label>
            <Input
              {...register('scopes')}
              placeholder="*, webhook.trigger"
              disabled={readOnly || isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              {SCOPE_OPTIONS.map((s) => `${s.value} (${s.label})`).join(', ')}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.apiKeys.expiresAt')}
            </label>
            <Input
              type="date"
              {...register('expiresAt')}
              disabled={readOnly || isSubmitting}
            />
            <p className="text-xs text-muted-foreground">{t('integration.apiKeys.neverExpires')} if left empty</p>
          </div>
        </form>

        <DialogFooter className="gap-2 sm:gap-0 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button disabled={isSubmitting} isLoading={isSubmitting} onClick={handleSubmit(onSubmit)}>
              {apiKey ? t('integration.apiKeys.edit') : t('integration.apiKeys.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
