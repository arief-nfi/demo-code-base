'use client';

import { Button } from '@saas/ui';
import { Input } from '@saas/ui';
import { PageContainer } from '@saas/ui';
import { PageHeader } from '@/components/page-header';
import { useRBAC, useAuthStore } from '@saas/ui';
import { apiClient, ApiRequestError } from '@saas/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building, Eye, EyeOff } from 'lucide-react';
import { forbidden, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

const tenantSchema = z.object({
  name: z.string().min(1, 'Tenant name is required'),
  slug: z
    .string()
    .min(1, 'Tenant identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase letters, numbers, and dashes'),
  adminName: z.string().min(1, 'Admin name is required'),
  adminUsername: z.string().min(1, 'Admin username is required'),
  adminEmail: z.email('Invalid email address').min(1, 'Admin email is required'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

type TenantFormValues = z.infer<typeof tenantSchema>;

export default function CreateTenantPage() {
  const { hasRole, isLoading: isRBACLoading } = useRBAC();
  const storedTenantName = useAuthStore(s => s.tenantName);
  const router = useRouter();
  const [serverError, setServerError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    document.title = `Create Tenant | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: {
      name: '',
      slug: '',
      adminName: '',
      adminUsername: '',
      adminEmail: '',
      adminPassword: '',
    },
  });

  if (isRBACLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!hasRole('SYSADMIN')) {
    forbidden();
  }

  const onSubmit = async (data: TenantFormValues) => {
    setServerError('');

    // Remove empty optional strings before sending? Or let backend handle it?
    // Backend creates default if undefined. But empty string might be treated as value?
    // Let's clean up empty strings to undefined to be safe with backend "||" logic.
    const cleanedData = {
      ...data,
      adminName: data.adminName || undefined,
      adminUsername: data.adminUsername || undefined,
      adminEmail: data.adminEmail || undefined,
      adminPassword: data.adminPassword || undefined,
    };

    try {
      await apiClient.post('/tenants', cleanedData);
      router.push('/tenants');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.errors) {
          const formFields = new Set(Object.keys(form.getValues()));
          let appliedToField = false;
          for (const [field, messages] of Object.entries(err.errors)) {
            if (formFields.has(field) && messages?.length) {
              form.setError(field as keyof TenantFormValues, { type: 'server', message: messages[0] });
              appliedToField = true;
            }
          }
          if (!appliedToField) {
            setServerError(err.message || 'An error occurred while creating the tenant. Please try again.');
          }
        } else {
          setServerError(err.message || 'An error occurred while creating the tenant. Please try again.');
        }
      } else {
        setServerError('An error occurred while creating the tenant. Please try again.');
      }
      console.error(err);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    form.setValue('name', name);

    // Auto-generate slug from name only if slug hasn't been manually edited (optional, 
    // but here we just auto-generate for convenience on every change for now or could just let user edit it)
    // A simple pattern is to update slug as long as it matches the previous slugified name, but for simplicity:
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    form.setValue('slug', slug, { shouldValidate: true });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Create Tenant"
        description="Provision a new tenant with its own isolated database schema."
        backUrl="/tenants"
      />

      <div className="rounded-lg bg-card p-6 text-card-foreground border border-border">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {serverError && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-md text-sm">
              {serverError}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Tenant Details</h3>
              <div className="space-y-2">
                <label
                  htmlFor="name"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Tenant Name <span className="text-red-500">*</span>
                </label>
                <Input
                  id="name"
                  {...form.register('name')}
                  onChange={(e) => {
                    form.register('name').onChange(e);
                    handleNameChange(e);
                  }}
                  placeholder="Acme Corp"
                  error={!!form.formState.errors.name}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="slug"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Tenant Identifier <span className="text-red-500">*</span>
                </label>
                <div className="flex">
                  <Input
                    id="slug"
                    {...form.register('slug')}
                    className="rounded-l-none"
                    placeholder="acme-corp"
                    error={!!form.formState.errors.slug}
                  />
                </div>
                {form.formState.errors.slug && (
                  <p className="text-sm text-destructive">{form.formState.errors.slug.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  This will be used to identify the tenant.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium">Initial Admin User</h3>
              
              <div className="space-y-2">
                <label
                  htmlFor="adminUsername"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Username <span className="text-red-500">*</span>
                </label>
                <Input
                  id="adminUsername"
                  {...form.register('adminUsername')}
                  placeholder="admin"
                  error={!!form.formState.errors.adminUsername}
                />
                {form.formState.errors.adminUsername && (
                  <p className="text-sm text-destructive">{form.formState.errors.adminUsername.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="adminName"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Full Name <span className="text-red-500">*</span>
                </label>
                <Input
                  id="adminName"
                  {...form.register('adminName')}
                  placeholder="Administrator"
                  error={!!form.formState.errors.adminName}
                />
                {form.formState.errors.adminName && (
                  <p className="text-sm text-destructive">{form.formState.errors.adminName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="adminEmail"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Email <span className="text-red-500">*</span>
                </label>
                <Input
                  id="adminEmail"
                  type="email"
                  {...form.register('adminEmail')}
                  placeholder="admin@example.com"
                  error={!!form.formState.errors.adminEmail}
                />
                {form.formState.errors.adminEmail && (
                  <p className="text-sm text-destructive">{form.formState.errors.adminEmail.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="adminPassword"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Password <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="adminPassword"
                      type={showPassword ? 'text' : 'password'}
                      {...form.register('adminPassword')}
                      placeholder="••••••••"
                      error={!!form.formState.errors.adminPassword}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const password = Array.from({ length: 12 }, () => {
                        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
                        return chars.charAt(Math.floor(Math.random() * chars.length));
                      }).join('');
                      form.setValue('adminPassword', password, { shouldValidate: true });
                    }}
                    className="whitespace-nowrap"
                  >
                    Generate
                  </Button>
                </div>
                {form.formState.errors.adminPassword && (
                  <p className="text-sm text-destructive">{form.formState.errors.adminPassword.message}</p>
                )}
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <Button type="submit" isLoading={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                'Provisioning...'
              ) : (
                <>
                  <Building className="mr-2 h-4 w-4" />
                  Create Tenant
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}
