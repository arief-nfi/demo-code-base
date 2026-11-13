'use client';

import {
  Button, DetailPageSkeleton, Input, Select, Label, Separator,
  PageContainer, ConfirmDialog, DeleteConfirmDialog,
  Card, CardContent, CardTitle, CardDescription,
  Badge, ColorPicker,
  useLanguage, useRBAC, API_URL, apiClient, useAuthStore,
} from '@saas/ui';
import { FileUpload } from '@/components/file-upload';
import { PageHeader } from '@/components/page-header';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from 'next-themes';
import { forbidden, useRouter } from 'next/navigation';
import {
  Building2, Globe, Hash, Image as ImageIcon, Save, Trash, Palette, RotateCcw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable().or(z.literal(''));

const schema = z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    logo: z.string().optional(),
    icon: z.string().optional(),
    domain: z.string().optional(),
    theme: z.enum(['LIGHT', 'DARK']),
    language: z.enum(['ENGLISH', 'INDONESIA']),
    currency: z.enum(['USD', 'IDR']),
    timezone: z.string().optional(),
    dateFormat: z.string().optional(),
    timeFormat: z.string().optional(),
    numberFormat: z.string().optional(),
    currencyFormat: z.string().optional(),
    primaryColor: hexColorSchema,
    accentColor: hexColorSchema,
    sidebarBackground: hexColorSchema,
    sidebarForeground: hexColorSchema,
});

type FormData = z.infer<typeof schema>;

const FormField = ({ label, description, error, required, children }: {
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label>
      {label}
      {required && <span className="text-destructive ml-1">*</span>}
    </Label>
    {description && <p className="text-xs text-muted-foreground">{description}</p>}
    {children}
    {error && <p className="text-sm text-destructive mt-1">{error}</p>}
  </div>
);

const SectionHeader = ({ icon, title, description }: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) => (
  <div className="flex items-start gap-3">
    <div className="rounded-lg bg-primary/10 p-2 mt-0.5">
      {icon}
    </div>
    <div>
      <CardTitle as="h3">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </div>
  </div>
);

import { use } from 'react';

export default function ManageTenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
    const { hasRole, isLoading: isRBACLoading } = useRBAC();
    const { tenantId } = use(params);
    const router = useRouter();

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [slug, setSlug] = useState<string>('');

    const storedTenantName = useAuthStore(s => s.tenantName);
    const storedTenantId = useAuthStore(s => s.tenantId);

    useEffect(() => {
        document.title = `Manage Tenant | ${storedTenantName || 'SaaS Admin'}`;
    }, [storedTenantName]);
    const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'TRIAL' | 'SUSPENDED' | 'PENDING' | 'TERMINATED'>('ACTIVE');
    const [isTogglingStatus, setIsTogglingStatus] = useState(false);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { setTheme } = useTheme();
    const { setLocale } = useLanguage();

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        control,
        formState: { errors },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: {
            theme: 'LIGHT',
            language: 'ENGLISH',
            currency: 'USD',
        },
    });

    useEffect(() => {
        if (isRBACLoading) return;
        const fetchPreferences = async () => {
            try {
                const data = await apiClient.get<Record<string, any>>(`/tenants/${tenantId}/config`);
                    // The backend returns a slightly different structure for getTenantConfig vs preferences
                    // It returns the TenantConfig object which has 'tenant' relation included.
                    // We need to map it correctly.
                    /* 
                       Response structure based on service:
                       {
                         id: ...,
                         tenantId: ...,
                         theme: ...,
                         language: ...,
                         ...
                         tenant: {
                           id: ...,
                           name: ...,
                           slug: ...
                         }
                       }
                    */

                    if (data.tenant) {
                        setValue('name', data.tenant.name);
                        setSlug(data.tenant.slug);
                        setStatus(data.tenant.status || 'ACTIVE');
                    }
                    setValue('domain', data.domain || '');

                    setValue('theme', data.theme);
                    setValue('language', data.language);
                    setValue('currency', data.currency);
                    setValue('timezone', data.timezone);
                    setValue('dateFormat', data.dateFormat);
                    setValue('timeFormat', data.timeFormat);
                    setValue('numberFormat', data.numberFormat);
                    setValue('currencyFormat', data.currencyFormat);
                    setValue('description', data.description || ''); // Description typically in config
                    setValue('logo', data.logo || '');
                    setValue('icon', data.icon || '');
                    setValue('primaryColor', data.primaryColor || '');
                    setValue('accentColor', data.accentColor || '');
                    setValue('sidebarBackground', data.sidebarBackground || '');
                    setValue('sidebarForeground', data.sidebarForeground || '');

                    // Update stores if the edited tenant is the current one
                    if (tenantId === storedTenantId) {
                        useAuthStore.getState().updateTenantInfo({
                            tenantName: data.tenant.name,
                            tenantDescription: data.description || null,
                            tenantLogo: data.logo || null,
                            tenantIcon: data.icon || null,
                            tenantPrimaryColor: data.primaryColor || null,
                            tenantAccentColor: data.accentColor || null,
                            tenantSidebarBackground: data.sidebarBackground || null,
                            tenantSidebarForeground: data.sidebarForeground || null,
                        });

                        setTheme(data.theme.toLowerCase());
                        setLocale(data.language === 'INDONESIA' ? 'id' : 'en');
                    }
            } catch (error) {
                console.warn('Failed to fetch preferences', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchPreferences();
    }, [setValue, isRBACLoading, tenantId]);

    if (isRBACLoading) {
        return <PageContainer><DetailPageSkeleton /></PageContainer>;
    }

    if (!hasRole('SYSADMIN')) {
        forbidden();
    }

    const onSubmit = async (data: FormData) => {
        setIsSaving(true);
        try {
            const payload = {
                ...data,
                primaryColor: data.primaryColor || null,
                accentColor: data.accentColor || null,
                sidebarBackground: data.sidebarBackground || null,
                sidebarForeground: data.sidebarForeground || null,
            };
            await apiClient.patch(`/tenants/${tenantId}/config`, payload);

            // Update stores if the edited tenant is the current one
            if (tenantId === storedTenantId) {
                useAuthStore.getState().updateTenantInfo({
                    tenantName: data.name,
                    tenantDescription: data.description || null,
                    tenantLogo: data.logo || null,
                    tenantIcon: data.icon || null,
                    tenantPrimaryColor: payload.primaryColor,
                    tenantAccentColor: payload.accentColor,
                    tenantSidebarBackground: payload.sidebarBackground,
                    tenantSidebarForeground: payload.sidebarForeground,
                });

                setTheme(data.theme.toLowerCase());
                setLocale(data.language === 'INDONESIA' ? 'id' : 'en');
            }

            toast.success('Tenant configuration updated successfully');
        } catch (error) {
            console.error(error);
            toast.error('Failed to update tenant configuration');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <PageContainer><DetailPageSkeleton /></PageContainer>;
    }

    const handleToggleStatus = () => {
        setShowConfirmDialog(true);
    };

    const confirmToggleStatus = async () => {
        setIsTogglingStatus(true);
        setShowConfirmDialog(false);
        try {
            const newStatus = status === 'ACTIVE' || status === 'TRIAL' ? 'INACTIVE' : 'ACTIVE';
            await apiClient.patch(`/tenants/${tenantId}/status`, { status: newStatus });

            setStatus(newStatus);
            toast.success(`Tenant ${newStatus.toLowerCase()} successfully`);
        } catch (error) {
            console.error(error);
            toast.error('Failed to update tenant status');
        } finally {
            setIsTogglingStatus(false);
        }
    };

    const handleSuspend = async () => {
        const reason = prompt('Suspension reason:');
        if (!reason) return;
        try {
            await apiClient.post(`/tenants/${tenantId}/suspend`, { reason });
            setStatus('SUSPENDED');
            toast.success('Tenant suspended');
        } catch (error) {
            console.error(error);
            toast.error('Failed to suspend tenant');
        }
    };

    const handleReactivate = async () => {
        try {
            await apiClient.post(`/tenants/${tenantId}/reactivate`);
            setStatus('ACTIVE');
            toast.success('Tenant reactivated');
        } catch (error) {
            console.error(error);
            toast.error('Failed to reactivate tenant');
        }
    };

    const handleTerminate = async () => {
        if (!confirm('Are you sure you want to terminate this tenant? This will schedule permanent deletion.')) return;
        try {
            await apiClient.post(`/tenants/${tenantId}/terminate`, { graceDays: 30 });
            setStatus('TERMINATED');
            toast.success('Tenant terminated — data will be deleted in 30 days');
        } catch (error) {
            console.error(error);
            toast.error('Failed to terminate tenant');
        }
    };

    const handleExportData = async () => {
        try {
            const res = await fetch(`${(await import('@saas/ui')).API_URL}/tenants/${tenantId}/export`, {
                credentials: 'include',
                headers: (await import('@saas/ui')).getAuthHeaders(),
            });
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tenant_export_${tenantId}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Data exported');
        } catch (error) {
            console.error(error);
            toast.error('Failed to export data');
        }
    };

    const handleDeleteTenant = () => {
        setShowDeleteDialog(true);
    };

    const confirmDeleteTenant = async () => {
        setIsDeleting(true);
        try {
            await apiClient.delete(`/tenants/${tenantId}`);

            toast.success('Tenant deleted successfully');
            router.push('/tenants');
        } catch (error) {
            console.error(error);
            toast.error('Failed to delete tenant');
        } finally {
            setIsDeleting(false);
            setShowDeleteDialog(false);
        }
    };

    return (
        <PageContainer>
            <PageHeader
                title={
                  <span className="flex items-center gap-2">
                    {watch('name') || 'Manage Tenant'}
                    <Badge variant={
                      status === 'ACTIVE' ? 'success' :
                      status === 'TRIAL' ? 'default' :
                      status === 'SUSPENDED' ? 'warning' :
                      'destructive'
                    } className="text-xs">
                      {status}
                    </Badge>
                  </span>
                }
                description="Manage tenant configuration and settings"
            >
                <div className="flex items-center gap-2 flex-wrap">
                    {(status === 'ACTIVE' || status === 'TRIAL') && (
                        <Button variant="outline" size="sm" onClick={handleSuspend}>Suspend</Button>
                    )}
                    {status === 'SUSPENDED' && (
                        <Button variant="primary" size="sm" onClick={handleReactivate}>Reactivate</Button>
                    )}
                    {status === 'INACTIVE' && (
                        <Button variant="primary" size="sm" onClick={handleToggleStatus} disabled={isTogglingStatus}>
                            {isTogglingStatus ? 'Updating...' : 'Activate'}
                        </Button>
                    )}
                    {(status === 'ACTIVE' || status === 'TRIAL') && (
                        <Button variant="outline" size="sm" onClick={handleToggleStatus} disabled={isTogglingStatus}>
                            {isTogglingStatus ? 'Updating...' : 'Deactivate'}
                        </Button>
                    )}
                    {status !== 'TERMINATED' && (
                        <Button variant="destructive" size="sm" onClick={handleTerminate}>Terminate</Button>
                    )}
                    <Button variant="outline" size="sm" onClick={handleExportData}>Export Data</Button>
                    {(status === 'TERMINATED' || status === 'INACTIVE') && (
                        <Button variant="destructive" size="sm" onClick={handleDeleteTenant} disabled={isDeleting}>
                            <Trash className="h-4 w-4 mr-1" /> Delete
                        </Button>
                    )}
                </div>
            </PageHeader>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <Card>
                <CardContent className="space-y-8 pt-6">
                  {/* General Information */}
                  <div className="space-y-5">
                    <SectionHeader
                      icon={<Building2 className="h-4 w-4 text-primary" />}
                      title="General Information"
                      description="Basic details about this tenant."
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <FormField label="Tenant Name" error={errors.name?.message} required description="The display name for this tenant.">
                        <Input
                          {...register('name')}
                          error={!!errors.name}
                          placeholder="Acme Corporation"
                        />
                      </FormField>
                      <FormField label="Domain" error={errors.domain?.message} description="Custom domain for the tenant portal.">
                        <Input
                          {...register('domain')}
                          error={!!errors.domain}
                          placeholder="app.acme.com"
                        />
                      </FormField>
                      <div className="md:col-span-2">
                        <FormField label="Description" error={errors.description?.message} description="A brief description of this tenant.">
                          <Input
                            {...register('description')}
                            error={!!errors.description}
                            placeholder="Enter a description..."
                          />
                        </FormField>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Branding */}
                  <div className="space-y-5">
                    <SectionHeader
                      icon={<ImageIcon className="h-4 w-4 text-primary" />}
                      title="Branding"
                      description="Customize the look and feel of the tenant application."
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <FormField label="Logo" error={errors.logo?.message} description="Displayed in the sidebar and header. Recommended: 200x60px.">
                        <Controller
                          control={control}
                          name="logo"
                          render={({ field }) => (
                            <FileUpload
                              value={field.value}
                              onChange={field.onChange}
                              error={!!errors.logo}
                              endpoint={`${API_URL}/tenants/upload?slug=${slug}`}
                            />
                          )}
                        />
                      </FormField>
                      <FormField label="Favicon / Icon" error={errors.icon?.message} description="Browser tab icon. Recommended: 32x32px or 64x64px.">
                        <Controller
                          control={control}
                          name="icon"
                          render={({ field }) => (
                            <FileUpload
                              value={field.value}
                              onChange={field.onChange}
                              error={!!errors.icon}
                            />
                          )}
                        />
                      </FormField>
                      <FormField label="Theme" error={errors.theme?.message} required description="Controls the overall color scheme.">
                        <Controller
                          control={control}
                          name="theme"
                          render={({ field }) => (
                            <Select
                              value={field.value}
                              onChange={field.onChange}
                              error={!!errors.theme}
                              options={[
                                { label: 'Light', value: 'LIGHT' },
                                { label: 'Dark', value: 'DARK' },
                              ]}
                            />
                          )}
                        />
                      </FormField>
                    </div>

                    <Separator className="my-4" />

                    {/* Custom Colors */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-primary/10 p-2 mt-0.5">
                            <Palette className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <CardTitle as="h4">Custom Colors</CardTitle>
                            <CardDescription>Override default brand colors for this tenant.</CardDescription>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => {
                            setValue('primaryColor', '', { shouldDirty: true });
                            setValue('accentColor', '', { shouldDirty: true });
                            setValue('sidebarBackground', '', { shouldDirty: true });
                            setValue('sidebarForeground', '', { shouldDirty: true });
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset to Defaults
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <FormField label="Primary Color" description="Main brand color used for buttons, links, and accents.">
                          <Controller
                            control={control}
                            name="primaryColor"
                            render={({ field }) => (
                              <ColorPicker
                                value={field.value || null}
                                onChange={(color) => field.onChange(color || '')}
                              />
                            )}
                          />
                        </FormField>
                        <FormField label="Accent Color" description="Secondary color for highlights and hover states.">
                          <Controller
                            control={control}
                            name="accentColor"
                            render={({ field }) => (
                              <ColorPicker
                                value={field.value || null}
                                onChange={(color) => field.onChange(color || '')}
                              />
                            )}
                          />
                        </FormField>
                        <FormField label="Sidebar Background" description="Background color of the navigation sidebar.">
                          <Controller
                            control={control}
                            name="sidebarBackground"
                            render={({ field }) => (
                              <ColorPicker
                                value={field.value || null}
                                onChange={(color) => field.onChange(color || '')}
                              />
                            )}
                          />
                        </FormField>
                        <FormField label="Sidebar Text Color" description="Text color used in the navigation sidebar.">
                          <Controller
                            control={control}
                            name="sidebarForeground"
                            render={({ field }) => (
                              <ColorPicker
                                value={field.value || null}
                                onChange={(color) => field.onChange(color || '')}
                              />
                            )}
                          />
                        </FormField>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Localization */}
                  <div className="space-y-5">
                    <SectionHeader
                      icon={<Globe className="h-4 w-4 text-primary" />}
                      title="Localization"
                      description="Language, currency, and timezone preferences."
                    />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      <FormField label="Language" error={errors.language?.message} required description="Interface language for all users.">
                        <Controller
                          control={control}
                          name="language"
                          render={({ field }) => (
                            <Select
                              value={field.value}
                              onChange={field.onChange}
                              error={!!errors.language}
                              options={[
                                { label: 'English', value: 'ENGLISH' },
                                { label: 'Indonesia', value: 'INDONESIA' },
                              ]}
                            />
                          )}
                        />
                      </FormField>
                      <FormField label="Currency" error={errors.currency?.message} required description="Default currency for monetary values.">
                        <Controller
                          control={control}
                          name="currency"
                          render={({ field }) => (
                            <Select
                              value={field.value}
                              onChange={field.onChange}
                              error={!!errors.currency}
                              options={[
                                { label: 'USD — US Dollar ($)', value: 'USD' },
                                { label: 'IDR — Rupiah (Rp)', value: 'IDR' },
                              ]}
                            />
                          )}
                        />
                      </FormField>
                      <FormField label="Timezone" error={errors.timezone?.message} description="Used for displaying dates and times.">
                        <Input
                          {...register('timezone')}
                          error={!!errors.timezone}
                          placeholder="Asia/Jakarta"
                        />
                      </FormField>
                    </div>
                  </div>

                  <Separator />

                  {/* Display Formats */}
                  <div className="space-y-5">
                    <SectionHeader
                      icon={<Hash className="h-4 w-4 text-primary" />}
                      title="Display Formats"
                      description="Control how dates, times, and numbers are formatted."
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <FormField label="Date Format" error={errors.dateFormat?.message} description="Pattern for displaying dates.">
                        <Input
                          {...register('dateFormat')}
                          error={!!errors.dateFormat}
                          placeholder="YYYY-MM-DD"
                        />
                      </FormField>
                      <FormField label="Time Format" error={errors.timeFormat?.message} description="Pattern for displaying times.">
                        <Input
                          {...register('timeFormat')}
                          error={!!errors.timeFormat}
                          placeholder="HH:mm:ss"
                        />
                      </FormField>
                      <FormField label="Number Format" error={errors.numberFormat?.message} description="Pattern for formatting numeric values.">
                        <Input
                          {...register('numberFormat')}
                          error={!!errors.numberFormat}
                          placeholder="1,000.00"
                        />
                      </FormField>
                      <FormField label="Currency Format" error={errors.currencyFormat?.message} description="Pattern for formatting currency values.">
                        <Input
                          {...register('currencyFormat')}
                          error={!!errors.currencyFormat}
                          placeholder="$1,000.00"
                        />
                      </FormField>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sticky Save Bar */}
              <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 bg-background/80 backdrop-blur-sm border-t border-border">
                <div className="flex items-center justify-end">
                  <Button type="submit" isLoading={isSaving} className="gap-2">
                    <Save className="h-4 w-4" />
                    Save Changes
                  </Button>
                </div>
              </div>
            </form>

            <ConfirmDialog
                isOpen={showConfirmDialog}
                onClose={() => setShowConfirmDialog(false)}
                onConfirm={confirmToggleStatus}
                title={status === 'ACTIVE' ? 'Deactivate Tenant' : 'Activate Tenant'}
                description={
                    status === 'ACTIVE'
                        ? 'Are you sure you want to deactivate this tenant? Users will not be able to access this tenant until it is reactivated.'
                        : 'Are you sure you want to activate this tenant? Users will be able to access this tenant again.'
                }
                confirmText={status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                variant={status === 'ACTIVE' ? 'destructive' : 'default'}
                loading={isTogglingStatus}
            />

            <DeleteConfirmDialog
                isOpen={showDeleteDialog}
                onClose={() => setShowDeleteDialog(false)}
                onConfirm={confirmDeleteTenant}
                title="Delete Tenant"
                description="This action cannot be undone. This will permanently delete the tenant, its database schema, and all associated data."
                confirmText="Delete Tenant"
                loading={isDeleting}
                confirmationValue={slug}
                confirmationLabel="Tenant Slug"
            />
        </PageContainer>
    );
}
