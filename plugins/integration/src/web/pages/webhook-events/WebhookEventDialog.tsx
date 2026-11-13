'use client';

import { useEffect } from 'react';
import {
  Button, Input, Textarea, Checkbox, apiClient,
  DialogRoot, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  useLanguage,
} from '@saas/ui';
import { toast } from 'sonner';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PayloadPreview } from './PayloadPreview';

interface WebhookEvent {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  payloadSchema?: unknown | null;
  samplePayload?: unknown | null;
  isActive: boolean;
  createdAt: string;
}

interface WebhookEventDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  event?: WebhookEvent | null;
  readOnly?: boolean;
}

const createWebhookEventSchema = (currentId?: string) =>
  z.object({
    code: z
      .string()
      .min(1, 'Code is required')
      .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/, 'Must be dot-notation (e.g., order.created)')
      .refine(async (code) => {
        try {
          const params: Record<string, string> = { code };
          if (currentId) params.excludeId = currentId;
          const data = await apiClient.get<{ available: boolean }>('/plugins/integration/webhook-events/check-code', params);
          return data.available;
        } catch {
          return true;
        }
      }, 'Event code already exists'),
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    category: z.string().optional(),
    payloadSchema: z.string().optional(),
    samplePayload: z.string().optional(),
    isActive: z.boolean(),
  });

type WebhookEventFormValues = z.infer<ReturnType<typeof createWebhookEventSchema>>;

export function WebhookEventDialog({
  isOpen,
  onClose,
  onSuccess,
  event,
  readOnly = false,
}: WebhookEventDialogProps) {
  const { t } = useLanguage();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<WebhookEventFormValues>({
    resolver: zodResolver(createWebhookEventSchema(event?.id)) as any,
    defaultValues: {
      code: '',
      name: '',
      description: '',
      category: '',
      payloadSchema: '',
      samplePayload: '',
      isActive: true,
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (event) {
        reset({
          code: event.code,
          name: event.name,
          description: event.description || '',
          category: event.category || '',
          payloadSchema: event.payloadSchema ? JSON.stringify(event.payloadSchema, null, 2) : '',
          samplePayload: event.samplePayload ? JSON.stringify(event.samplePayload, null, 2) : '',
          isActive: event.isActive,
        });
      } else {
        reset({
          code: '',
          name: '',
          description: '',
          category: '',
          payloadSchema: '',
          samplePayload: '',
          isActive: true,
        });
      }
    }
  }, [isOpen, event, reset]);

  const onSubmit = async (data: WebhookEventFormValues) => {
    try {
      let payloadSchema: unknown | undefined;
      let samplePayload: unknown | undefined;

      if (data.payloadSchema && data.payloadSchema.trim()) {
        try {
          payloadSchema = JSON.parse(data.payloadSchema);
        } catch {
          toast.error('Invalid JSON in Payload Schema field');
          return;
        }
      }

      if (data.samplePayload && data.samplePayload.trim()) {
        try {
          samplePayload = JSON.parse(data.samplePayload);
        } catch {
          toast.error('Invalid JSON in Sample Payload field');
          return;
        }
      }

      const payload = {
        code: data.code,
        name: data.name,
        description: data.description || undefined,
        category: data.category || undefined,
        payloadSchema,
        samplePayload,
        isActive: data.isActive,
      };

      if (event) {
        await apiClient.patch(`/plugins/integration/webhook-events/${event.id}`, payload);
        toast.success(t('integration.webhookEvents.updateSuccess'));
      } else {
        await apiClient.post('/plugins/integration/webhook-events', payload);
        toast.success(t('integration.webhookEvents.createSuccess'));
      }
      onSuccess();
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('integration.webhookEvents.saveError');
      toast.error(message);
    }
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {readOnly
              ? t('integration.webhookEvents.view')
              : event
                ? t('integration.webhookEvents.edit')
                : t('integration.webhookEvents.create')}
          </DialogTitle>
          <DialogDescription>
            {t('integration.webhookEvents.description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.webhookEvents.code')} <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                error={!!errors.code}
                {...register('code')}
                placeholder={t('integration.webhookEvents.codePlaceholder')}
                disabled={readOnly || isSubmitting || !!event}
              />
              <p className="text-xs text-muted-foreground">{t('integration.webhookEvents.codeHint')}</p>
              {errors.code && (
                <p className="text-sm text-red-500">{errors.code.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.webhookEvents.name')} <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                error={!!errors.name}
                {...register('name')}
                placeholder={t('integration.webhookEvents.namePlaceholder')}
                disabled={readOnly || isSubmitting}
              />
              {errors.name && (
                <p className="text-sm text-red-500">{errors.name.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.webhookEvents.category')}
              </label>
              <Input
                type="text"
                {...register('category')}
                placeholder={t('integration.webhookEvents.categoryPlaceholder')}
                disabled={readOnly || isSubmitting}
              />
            </div>

            <div className="flex items-end pb-2">
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
                    <span className="text-sm font-medium">{t('integration.webhookEvents.active')}</span>
                  </label>
                )}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.webhookEvents.descriptionLabel')}
            </label>
            <Textarea
              {...register('description')}
              placeholder={t('integration.webhookEvents.descriptionPlaceholder')}
              disabled={readOnly || isSubmitting}
              rows={2}
            />
          </div>

          {readOnly && event?.samplePayload ? (
            <PayloadPreview
              label={t('integration.webhookEvents.samplePayload')}
              data={event.samplePayload}
            />
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none text-foreground">
                  {t('integration.webhookEvents.payloadSchema')}
                </label>
                <Textarea
                  {...register('payloadSchema')}
                  placeholder={t('integration.webhookEvents.payloadSchemaPlaceholder')}
                  disabled={readOnly || isSubmitting}
                  rows={4}
                  className="font-mono text-sm"
                />
                {errors.payloadSchema && (
                  <p className="text-sm text-red-500">{errors.payloadSchema.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none text-foreground">
                  {t('integration.webhookEvents.samplePayload')}
                </label>
                <Textarea
                  {...register('samplePayload')}
                  placeholder={t('integration.webhookEvents.samplePayloadPlaceholder')}
                  disabled={readOnly || isSubmitting}
                  rows={4}
                  className="font-mono text-sm"
                />
                {errors.samplePayload && (
                  <p className="text-sm text-red-500">{errors.samplePayload.message}</p>
                )}
              </div>
            </>
          )}

          {readOnly && event?.payloadSchema && (
            <PayloadPreview
              label={t('integration.webhookEvents.payloadSchema')}
              data={event.payloadSchema}
            />
          )}
        </form>

        <DialogFooter className="gap-2 sm:gap-0 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button
              disabled={isSubmitting}
              isLoading={isSubmitting}
              onClick={handleSubmit(onSubmit)}
            >
              {event ? t('integration.webhookEvents.edit') : t('integration.webhookEvents.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
