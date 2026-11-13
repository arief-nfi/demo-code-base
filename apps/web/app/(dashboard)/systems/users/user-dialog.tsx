'use client';

import { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  cn,
  Button,
  Checkbox,
  Select,
  Input,
  apiClient,
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@saas/ui';
import { toast } from 'sonner';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface Role {
  id: string;
  name: string;
}

interface User {
  id: string;
  email: string;
  username: string;
  name?: string;
  status: 'ACTIVE' | 'INACTIVE';
  roles: Role[];
}

interface UserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  user?: User | null;
  readOnly?: boolean;
}

const createUserSchema = (currentId?: string) => z.object({
  email: z.string()
    .email('Invalid email address')
    .refine(async (email) => {
      try {
        const params: Record<string, string> = { email };
        if (currentId) params.excludeId = currentId;
        const data = await apiClient.get<{ available: boolean }>('/system/users/check-email', params);
        return data.available;
      } catch {
        return true;
      }
    }, 'Email already exists'),
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens')
    .refine(async (username) => {
      try {
        const params: Record<string, string> = { username };
        if (currentId) params.excludeId = currentId;
        const data = await apiClient.get<{ available: boolean }>('/system/users/check-username', params);
        return data.available;
      } catch {
        return true;
      }
    }, 'Username already exists'),
  name: z.string().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
  roleIds: z.array(z.string()).optional(),
}).refine((data) => {
  if (!currentId && !data.password) {
    return false;
  }
  return true;
}, {
  message: "Password is required for new users",
  path: ["password"],
});

type UserFormValues = z.infer<ReturnType<typeof createUserSchema>>;

export function UserDialog({
  isOpen,
  onClose,
  onSuccess,
  user,
  readOnly = false,
}: UserDialogProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  const userRef = useRef(user);
  userRef.current = user;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: (values, context, options) =>
      zodResolver(createUserSchema(userRef.current?.id))(values, context, options),
    defaultValues: {
      email: '',
      username: '',
      name: '',
      status: 'ACTIVE',
      password: '',
      roleIds: [],
    },
  });

  const selectedRoleIds = watch('roleIds') || [];

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const data = await apiClient.get<{ data: Role[] }>('/system/roles');
        setRoles(data.data || []);
      } catch (error) {
        console.warn('Failed to fetch roles', error);
      }
    };

    if (isOpen) {
      fetchRoles();
      if (user) {
        reset({
          email: user.email,
          username: user.username,
          name: user.name || '',
          status: user.status || 'ACTIVE',
          password: '',
          roleIds: user.roles.map(r => r.id),
        });
      } else {
        reset({
          email: '',
          username: '',
          name: '',
          status: 'ACTIVE',
          password: '',
          roleIds: [],
        });
      }
    }
  }, [isOpen, user, reset]);

  const onSubmit = async (data: UserFormValues) => {
    if (readOnly) return;
    try {
      if (user && !data.password) {
        delete data.password;
      }

      if (user) {
        await apiClient.patch(`/system/users/${user.id}`, data);
      } else {
        await apiClient.post('/system/users', data);
      }
      toast.success(`User ${user ? 'updated' : 'created'} successfully`);
      onSuccess();
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An error occurred while saving user';
      toast.error(message);
    }
  };

  const toggleRole = (roleId: string) => {
    if (readOnly) return;
    const current = selectedRoleIds;
    if (current.includes(roleId)) {
      setValue('roleIds', current.filter(id => id !== roleId));
    } else {
      setValue('roleIds', [...current, roleId]);
    }
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? 'User Details' : user ? 'Edit User' : 'Create User'}
          </DialogTitle>
          <DialogDescription>
            {readOnly ? 'View user details.' : user ? 'Update existing user details.' : 'Add a new user to the system.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Username <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              error={!!errors.username}
              {...register('username')}
              placeholder="johndoe"
              disabled={readOnly}
            />
            {errors.username && (
              <p className="text-sm text-red-500">{errors.username.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Email <span className="text-red-500">*</span>
            </label>
            <Input
              type="email"
              error={!!errors.email}
              {...register('email')}
              placeholder="john.doe@example.com"
              disabled={readOnly}
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              error={!!errors.name}
              {...register('name')}
              placeholder="John Doe"
              disabled={readOnly}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Status <span className="text-red-500">*</span>
            </label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { label: 'Active', value: 'ACTIVE' },
                    { label: 'Inactive', value: 'INACTIVE' },
                  ]}
                  error={!!errors.status}
                  disabled={readOnly}
                />
              )}
            />
            {errors.status && (
              <p className="text-sm text-red-500">{errors.status.message}</p>
            )}
          </div>

          {!readOnly && (
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                Password {!user && <span className="text-red-500">*</span>} {user && '(Leave blank to keep unchanged)'}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  className="pr-10"
                  error={!!errors.password}
                  {...register('password')}
                  placeholder="********"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-red-500">{errors.password.message}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground">
              Roles
            </label>
            <div className="border border-border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto shadow-sm bg-muted/10">
              {roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No roles available.</p>
              ) : (
                roles.map((role) => (
                  <div key={role.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`role-${role.id}`}
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={() => toggleRole(role.id)}
                      disabled={readOnly}
                    />
                    <label
                      htmlFor={`role-${role.id}`}
                      className={cn(
                        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer",
                        readOnly && "cursor-default"
                      )}
                    >
                      {role.name}
                    </label>
                  </div>
                ))
              )}
            </div>
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
              {user ? 'Update' : 'Create'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
