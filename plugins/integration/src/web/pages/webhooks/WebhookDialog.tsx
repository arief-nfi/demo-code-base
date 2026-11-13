'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button, Input, Textarea, Checkbox, Select, apiClient,
  DialogRoot, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  useLanguage,
} from '@saas/ui';
import { toast } from 'sonner';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface Webhook {
  id: string;
  partnerId: string;
  eventId: string;
  url: string;
  description?: string | null;
  headers?: Record<string, string> | null;
  retryPolicy?: { maxAttempts?: number; backoffMs?: number; backoffMultiplier?: number } | null;
  isActive: boolean;
  partner?: { id: string; name: string };
  event?: { id: string; name: string; code: string };
}

interface Partner {
  id: string;
  name: string;
  code: string;
}

interface WebhookEvent {
  id: string;
  name: string;
  code: string;
}

interface WebhookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (secret?: string) => void;
  webhook?: Webhook | null;
  readOnly?: boolean;
  partners: Partner[];
  events: WebhookEvent[];
}

const webhookFormSchema = z.object({
  partnerId: z.string().min(1, 'Partner is required'),
  eventId: z.string().min(1, 'Event is required'),
  url: z.string().url('Must be a valid URL'),
  description: z.string().optional(),
  isActive: z.boolean(),
  headers: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })),
  maxAttempts: z.coerce.number().min(1).max(10).default(3),
  backoffMs: z.coerce.number().min(100).max(60000).default(1000),
  backoffMultiplier: z.coerce.number().min(1).max(5).default(2),
});

type WebhookFormValues = z.infer<typeof webhookFormSchema>;

export function WebhookDialog({
  isOpen,
  onClose,
  onSuccess,
  webhook,
  readOnly = false,
  partners,
  events,
}: WebhookDialogProps) {
  const { t } = useLanguage();
  const [secretDisplay, setSecretDisplay] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<WebhookFormValues>({
    resolver: zodResolver(webhookFormSchema) as any,
    defaultValues: {
      partnerId: '',
      eventId: '',
      url: '',
      description: '',
      isActive: true,
      headers: [],
      maxAttempts: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'headers' });

  useEffect(() => {
    if (isOpen) {
      setSecretDisplay(null);
      if (webhook) {
        const headerEntries = webhook.headers
          ? Object.entries(webhook.headers).map(([key, value]) => ({ key, value }))
          : [];
        reset({
          partnerId: webhook.partnerId,
          eventId: webhook.eventId,
          url: webhook.url,
          description: webhook.description || '',
          isActive: webhook.isActive,
          headers: headerEntries,
          maxAttempts: webhook.retryPolicy?.maxAttempts ?? 3,
          backoffMs: webhook.retryPolicy?.backoffMs ?? 1000,
          backoffMultiplier: webhook.retryPolicy?.backoffMultiplier ?? 2,
        });
      } else {
        reset({
          partnerId: '',
          eventId: '',
          url: '',
          description: '',
          isActive: true,
          headers: [],
          maxAttempts: 3,
          backoffMs: 1000,
          backoffMultiplier: 2,
        });
      }
    }
  }, [isOpen, webhook, reset]);

  const onSubmit = async (data: WebhookFormValues) => {
    try {
      const headers: Record<string, string> = {};
      data.headers.forEach((h) => {
        if (h.key.trim()) headers[h.key.trim()] = h.value;
      });

      const payload = {
        partnerId: data.partnerId,
        eventId: data.eventId,
        url: data.url,
        description: data.description || undefined,
        isActive: data.isActive,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        retryPolicy: {
          maxAttempts: data.maxAttempts,
          backoffMs: data.backoffMs,
          backoffMultiplier: data.backoffMultiplier,
        },
      };

      if (webhook) {
        await apiClient.patch(`/plugins/integration/webhooks/${webhook.id}`, payload);
        toast.success(t('integration.webhooks.updateSuccess'));
        onSuccess();
      } else {
        const result = await apiClient.post<{ webhook: Webhook; secret: string }>('/plugins/integration/webhooks', payload);
        toast.success(t('integration.webhooks.createSuccess'));
        onSuccess(result.secret);
      }
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('integration.webhooks.saveError');
      toast.error(message);
    }
  };

  const partnerOptions = partners.map((p) => ({ label: p.name, value: p.id }));
  const eventOptions = events.map((e) => ({ label: `${e.code} — ${e.name}`, value: e.id }));

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {readOnly
              ? t('integration.webhooks.view')
              : webhook
                ? t('integration.webhooks.edit')
                : t('integration.webhooks.create')}
          </DialogTitle>
          <DialogDescription>
            {t('integration.webhooks.description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.webhooks.partner')} <span className="text-red-500">*</span>
              </label>
              <Controller
                name="partnerId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onChange={field.onChange}
                    options={partnerOptions}
                    placeholder={t('integration.webhooks.selectPartner')}
                    disabled={readOnly || isSubmitting || !!webhook}
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
                {t('integration.webhooks.event')} <span className="text-red-500">*</span>
              </label>
              <Controller
                name="eventId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onChange={field.onChange}
                    options={eventOptions}
                    placeholder={t('integration.webhooks.selectEvent')}
                    disabled={readOnly || isSubmitting || !!webhook}
                    error={!!errors.eventId}
                  />
                )}
              />
              {errors.eventId && (
                <p className="text-sm text-red-500">{errors.eventId.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.webhooks.url')} <span className="text-red-500">*</span>
            </label>
            <Input
              type="url"
              error={!!errors.url}
              {...register('url')}
              placeholder={t('integration.webhooks.urlPlaceholder')}
              disabled={readOnly || isSubmitting}
            />
            {errors.url && (
              <p className="text-sm text-red-500">{errors.url.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.webhooks.descriptionLabel')}
            </label>
            <Textarea
              {...register('description')}
              placeholder={t('integration.webhooks.descriptionPlaceholder')}
              disabled={readOnly || isSubmitting}
              rows={2}
            />
          </div>

          {/* Custom Headers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.webhooks.headers')}
              </label>
              {!readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => append({ key: '', value: '' })}
                >
                  <Plus className="h-3 w-3" /> {t('integration.webhooks.addHeader')}
                </Button>
              )}
            </div>
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2">
                <Input
                  {...register(`headers.${index}.key`)}
                  placeholder={t('integration.webhooks.headerKeyPlaceholder')}
                  disabled={readOnly || isSubmitting}
                  className="flex-1"
                />
                <Input
                  {...register(`headers.${index}.value`)}
                  placeholder={t('integration.webhooks.headerValuePlaceholder')}
                  disabled={readOnly || isSubmitting}
                  className="flex-1"
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Retry Policy */}
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.webhooks.retryPolicy')}
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('integration.webhooks.maxAttempts')}</label>
                <Input
                  type="number"
                  {...register('maxAttempts')}
                  disabled={readOnly || isSubmitting}
                  min={1}
                  max={10}
                />
                {errors.maxAttempts && (
                  <p className="text-xs text-red-500">{errors.maxAttempts.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('integration.webhooks.backoffMs')}</label>
                <Input
                  type="number"
                  {...register('backoffMs')}
                  disabled={readOnly || isSubmitting}
                  min={100}
                  max={60000}
                />
                {errors.backoffMs && (
                  <p className="text-xs text-red-500">{errors.backoffMs.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('integration.webhooks.backoffMultiplier')}</label>
                <Input
                  type="number"
                  {...register('backoffMultiplier')}
                  disabled={readOnly || isSubmitting}
                  min={1}
                  max={5}
                  step={0.5}
                />
                {errors.backoffMultiplier && (
                  <p className="text-xs text-red-500">{errors.backoffMultiplier.message}</p>
                )}
              </div>
            </div>
          </div>

          <Controller
            name="isActive"
            control={control}
            render={({ field }) => (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  disabled={readOnly || isSubmitting}
                />
                <span className="text-sm font-medium">{t('integration.webhooks.isActive')}</span>
              </label>
            )}
          />
        </form>

        <DialogFooter className="gap-2 sm:gap-0 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button disabled={isSubmitting} isLoading={isSubmitting} onClick={handleSubmit(onSubmit)}>
              {webhook ? t('integration.webhooks.edit') : t('integration.webhooks.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
