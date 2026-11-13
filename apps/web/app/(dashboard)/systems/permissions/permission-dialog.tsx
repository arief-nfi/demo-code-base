'use client';

import { useEffect } from 'react';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
  Textarea,
  apiClient,
} from '@saas/ui';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface Permission {
  id: string;
  name: string;
  description: string;
}

interface PermissionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  permission?: Permission | null;
  readOnly?: boolean;
}

const createPermissionSchema = (currentId?: string) => z.object({
  name: z.string()
    .min(3, 'Name must be at least 3 characters')
    .regex(/^[a-z0-9.]+$/, 'Name must only contain lowercase letters, numbers, and dots')
    .refine(async (name) => {
      try {
        const params: Record<string, string> = { name };
        if (currentId) params.excludeId = currentId;
        const data = await apiClient.get<{ available: boolean }>('/system/permissions/check-name', params);
        return data.available;
      } catch {
        return true;
      }
    }, 'Permission name already exists'),
  description: z.string().min(1, 'Description is required'),
});

type PermissionFormValues = z.infer<ReturnType<typeof createPermissionSchema>>;

export function PermissionDialog({
  isOpen,
  onClose,
  onSuccess,
  permission,
  readOnly = false,
}: PermissionDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PermissionFormValues>({
    resolver: zodResolver(createPermissionSchema(permission?.id)),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (permission) {
        reset({
          name: permission.name,
          description: permission.description,
        });
      } else {
        reset({
          name: '',
          description: '',
        });
      }
    }
  }, [isOpen, permission, reset]);

  const onSubmit = async (data: PermissionFormValues) => {
    try {
      if (permission) {
        await apiClient.patch(`/system/permissions/${permission.id}`, data);
      } else {
        await apiClient.post('/system/permissions', data);
      }
      toast.success(`Permission ${permission ? 'updated' : 'created'} successfully`);
      onSuccess();
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An error occurred while saving permission';
      toast.error(message);
    }
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? 'Permission Details' : (permission ? 'Edit Permission' : 'Create Permission')}
          </DialogTitle>
          <DialogDescription>
            {readOnly ? 'View permission details.' : (permission ? 'Update existing permission details.' : 'Add a new permission to the system.')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              error={!!errors.name}
              {...register('name')}
              placeholder="e.g. users.read"
              disabled={readOnly || isSubmitting}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Description <span className="text-red-500">*</span>
            </label>
            <Textarea
              error={!!errors.description}
              {...register('description')}
              placeholder="Describe what this permission allows..."
              disabled={readOnly || isSubmitting}
            />
            {errors.description && (
              <p className="text-sm text-red-500">{errors.description.message}</p>
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
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button
              disabled={isSubmitting}
              isLoading={isSubmitting}
              onClick={handleSubmit(onSubmit)}
            >
              {permission ? 'Update' : 'Create'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
