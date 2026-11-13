'use client';

import { useEffect } from 'react';
import {
  Button, Input, Textarea, apiClient,
  DialogRoot, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  useLanguage,
} from '@saas/ui';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface Partner {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface PartnerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  partner?: Partner | null;
  readOnly?: boolean;
}

const createPartnerSchema = (currentId?: string) =>
  z.object({
    code: z
      .string()
      .min(1, 'Code is required')
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be kebab-case (e.g., partner-abc)')
      .refine(async (code) => {
        try {
          const params: Record<string, string> = { code };
          if (currentId) params.excludeId = currentId;
          const data = await apiClient.get<{ available: boolean }>('/plugins/integration/partners/check-code', params);
          return data.available;
        } catch {
          return true;
        }
      }, 'Partner code already exists'),
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    contactName: z.string().optional(),
    contactEmail: z.string().email('Invalid email format').optional().or(z.literal('')),
    metadata: z.string().optional(),
  });

type PartnerFormValues = z.infer<ReturnType<typeof createPartnerSchema>>;

export function PartnerDialog({
  isOpen,
  onClose,
  onSuccess,
  partner,
  readOnly = false,
}: PartnerDialogProps) {
  const { t } = useLanguage();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PartnerFormValues>({
    resolver: zodResolver(createPartnerSchema(partner?.id)) as any,
    defaultValues: {
      code: '',
      name: '',
      description: '',
      contactName: '',
      contactEmail: '',
      metadata: '',
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (partner) {
        reset({
          code: partner.code,
          name: partner.name,
          description: partner.description || '',
          contactName: partner.contactName || '',
          contactEmail: partner.contactEmail || '',
          metadata: partner.metadata ? JSON.stringify(partner.metadata, null, 2) : '',
        });
      } else {
        reset({
          code: '',
          name: '',
          description: '',
          contactName: '',
          contactEmail: '',
          metadata: '',
        });
      }
    }
  }, [isOpen, partner, reset]);

  const onSubmit = async (data: PartnerFormValues) => {
    try {
      let metadata: Record<string, unknown> | undefined;
      if (data.metadata && data.metadata.trim()) {
        try {
          metadata = JSON.parse(data.metadata);
        } catch {
          toast.error('Invalid JSON in metadata field');
          return;
        }
      }

      const payload = {
        code: data.code,
        name: data.name,
        description: data.description || undefined,
        contactName: data.contactName || undefined,
        contactEmail: data.contactEmail || undefined,
        metadata,
      };

      if (partner) {
        await apiClient.patch(`/plugins/integration/partners/${partner.id}`, payload);
        toast.success(t('integration.partners.updateSuccess'));
      } else {
        await apiClient.post('/plugins/integration/partners', payload);
        toast.success(t('integration.partners.createSuccess'));
      }
      onSuccess();
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('integration.partners.saveError');
      toast.error(message);
    }
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {readOnly
              ? t('integration.partners.view')
              : partner
                ? t('integration.partners.edit')
                : t('integration.partners.create')}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? t('integration.partners.description')
              : partner
                ? t('integration.partners.edit')
                : t('integration.partners.create')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.partners.code')} <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                error={!!errors.code}
                {...register('code')}
                placeholder={t('integration.partners.codePlaceholder')}
                disabled={readOnly || isSubmitting || !!partner}
              />
              <p className="text-xs text-muted-foreground">{t('integration.partners.codeHint')}</p>
              {errors.code && (
                <p className="text-sm text-red-500">{errors.code.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.partners.name')} <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                error={!!errors.name}
                {...register('name')}
                placeholder={t('integration.partners.namePlaceholder')}
                disabled={readOnly || isSubmitting}
              />
              {errors.name && (
                <p className="text-sm text-red-500">{errors.name.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.partners.descriptionLabel')}
            </label>
            <Textarea
              error={!!errors.description}
              {...register('description')}
              placeholder={t('integration.partners.descriptionPlaceholder')}
              disabled={readOnly || isSubmitting}
              rows={3}
            />
            {errors.description && (
              <p className="text-sm text-red-500">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.partners.contactName')}
              </label>
              <Input
                type="text"
                error={!!errors.contactName}
                {...register('contactName')}
                placeholder={t('integration.partners.contactNamePlaceholder')}
                disabled={readOnly || isSubmitting}
              />
              {errors.contactName && (
                <p className="text-sm text-red-500">{errors.contactName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                {t('integration.partners.contactEmail')}
              </label>
              <Input
                type="email"
                error={!!errors.contactEmail}
                {...register('contactEmail')}
                placeholder={t('integration.partners.contactEmailPlaceholder')}
                disabled={readOnly || isSubmitting}
              />
              {errors.contactEmail && (
                <p className="text-sm text-red-500">{errors.contactEmail.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              {t('integration.partners.metadata')}
            </label>
            <Textarea
              error={!!errors.metadata}
              {...register('metadata')}
              placeholder={'{\n  "key": "value"\n}'}
              disabled={readOnly || isSubmitting}
              rows={4}
              className="font-mono text-sm"
            />
            {errors.metadata && (
              <p className="text-sm text-red-500">{errors.metadata.message}</p>
            )}
          </div>
        </form>

        <DialogFooter className="gap-2 sm:gap-0 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {readOnly ? t('integration.partners.view') === 'View' ? 'Close' : 'Tutup' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button
              disabled={isSubmitting}
              isLoading={isSubmitting}
              onClick={handleSubmit(onSubmit)}
            >
              {partner ? t('integration.partners.edit') : t('integration.partners.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
