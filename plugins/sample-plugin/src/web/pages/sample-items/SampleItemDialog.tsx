'use client';

import { useEffect } from 'react';
import {
  Button,
  Input,
  apiClient,
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  useLanguage,
} from '@saas/ui';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface UserRef {
  id: string;
  name: string | null;
  username: string;
}

interface SampleItem {
  id: string;
  name: string;
  value?: string | null;
  createdById?: string | null;
  updatedById?: string | null;
  createdBy?: UserRef | null;
  updatedBy?: UserRef | null;
  createdAt: string;
}

interface SampleItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  item?: SampleItem | null;
  readOnly?: boolean;
}

const createSampleItemSchema = (currentId?: string) =>
  z.object({
    name: z.string().min(1, 'Name is required').refine(async (name) => {
      try {
        const params: Record<string, string> = { name };
        if (currentId) params.excludeId = currentId;
        const data = await apiClient.get<{ available: boolean }>('/plugins/sample-plugin/items/check-name', params);
        return data.available;
      } catch {
        return true;
      }
    }, 'Sample item name already exists'),
    value: z.string().optional(),
  });

type SampleItemFormValues = z.infer<ReturnType<typeof createSampleItemSchema>>;

export function SampleItemDialog({
  isOpen,
  onClose,
  onSuccess,
  item,
  readOnly = false,
}: SampleItemDialogProps) {
  const { t } = useLanguage();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SampleItemFormValues>({
    resolver: zodResolver(createSampleItemSchema(item?.id)) as any,
    defaultValues: {
      name: '',
      value: '',
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (item) {
        reset({
          name: item.name,
          value: item.value || '',
        });
      } else {
        reset({
          name: '',
          value: '',
        });
      }
    }
  }, [isOpen, item, reset]);

  const onSubmit = async (data: SampleItemFormValues) => {
    try {
      if (item) {
        await apiClient.patch(`/plugins/sample-plugin/items/${item.id}`, data);
      } else {
        await apiClient.post('/plugins/sample-plugin/items', data);
      }
      toast.success(`Sample item ${item ? 'updated' : 'created'} successfully`);
      onSuccess();
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An error occurred while saving sample item';
      toast.error(message);
    }
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? 'Sample Item Details' : (item ? 'Edit Sample Item' : 'Create Sample Item')}
          </DialogTitle>
          <DialogDescription>
            {readOnly ? 'View sample item details.' : (item ? 'Update existing sample item details.' : 'Add a new sample item to the system.')}
          </DialogDescription>
        </DialogHeader>

        <form id="sample-item-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              error={!!errors.name}
              {...register('name')}
              placeholder="Enter item name"
              disabled={readOnly || isSubmitting}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Value
            </label>
            <Input
              type="text"
              error={!!errors.value}
              {...register('value')}
              placeholder="Optional value"
              disabled={readOnly || isSubmitting}
            />
            {errors.value && (
              <p className="text-sm text-red-500">{errors.value.message}</p>
            )}
          </div>
        </form>

        {item && (item.createdById || item.updatedById) && (
          <div className="px-6 pt-2 text-xs text-muted-foreground space-y-0.5">
            {item.createdById && (
              <p>
                {t('samplePlugin.items.createdBy', {
                  name: item.createdBy?.name ?? item.createdBy?.username ?? t('samplePlugin.items.deletedUser'),
                })}
              </p>
            )}
            {item.updatedById && (
              <p>
                {t('samplePlugin.items.updatedBy', {
                  name: item.updatedBy?.name ?? item.updatedBy?.username ?? t('samplePlugin.items.deletedUser'),
                })}
              </p>
            )}
          </div>
        )}

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
              type="submit"
              form="sample-item-form"
              disabled={isSubmitting}
              isLoading={isSubmitting}
            >
              {item ? 'Update' : 'Create'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
