'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { forbidden } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import * as z from 'zod';
import {
  Building2, Globe, Hash, Save, Image as ImageIcon, Palette, RotateCcw,
} from 'lucide-react';
import {
  apiClient, PageContainer, Button, Input, Label, Select, Separator,
  DetailPageSkeleton, Card, CardTitle, CardDescription, CardContent,
  useRBAC, useLanguage, useAuthStore, usePreferencesStore, ColorPicker,
} from '@saas/ui';
import { FileUpload } from '@/components/file-upload';
import { PageHeader } from '@/components/page-header';

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

export default function PreferencesPage() {
  const { hasRole, isLoading: isRBACLoading } = useRBAC();

  const storedTenantName = useAuthStore(s => s.tenantName);

  useEffect(() => {
    document.title = `Preferences | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { setTheme } = useTheme();
  const { setLocale } = useLanguage();

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isDirty },
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
        const data = await apiClient.get<Record<string, any>>('/tenants/config');
        setValue('name', data.tenant.name);
        setValue('description', data.description || '');
        setValue('logo', data.logo || '');
        setValue('icon', data.icon || '');
        setValue('domain', data.domain || '');
        setValue('theme', data.theme || 'LIGHT');
        setValue('language', data.language || 'ENGLISH');
        setValue('currency', data.currency || 'USD');
        setValue('timezone', data.timezone || '');
        setValue('dateFormat', data.dateFormat || '');
        setValue('timeFormat', data.timeFormat || '');
        setValue('numberFormat', data.numberFormat || '');
        setValue('currencyFormat', data.currencyFormat || '');
        setValue('primaryColor', data.primaryColor || '');
        setValue('accentColor', data.accentColor || '');
        setValue('sidebarBackground', data.sidebarBackground || '');
        setValue('sidebarForeground', data.sidebarForeground || '');

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
        usePreferencesStore.getState().setPreferences({
          ...(data.dateFormat && { dateFormat: data.dateFormat }),
          ...(data.timeFormat && { timeFormat: data.timeFormat }),
          ...(data.timezone && { timezone: data.timezone }),
          ...(data.currency && { currency: data.currency }),
          ...(data.numberFormat && { numberFormat: data.numberFormat }),
          ...(data.currencyFormat && { currencyFormat: data.currencyFormat }),
        });

        setTheme(data.theme.toLowerCase());
        setLocale(data.language === 'INDONESIA' ? 'id' : 'en');
      } catch (error) {
        console.warn('Failed to fetch preferences', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPreferences();
  }, [setValue, isRBACLoading]);

  if (isRBACLoading) {
    return <PageContainer><DetailPageSkeleton /></PageContainer>;
  }

  if (!hasRole('ADMIN')) {
    forbidden();
  }

  const onSubmit = async (data: FormData) => {
    setIsSaving(true);
    try {
      // Normalize empty strings to null for color fields
      const payload = {
        ...data,
        primaryColor: data.primaryColor || null,
        accentColor: data.accentColor || null,
        sidebarBackground: data.sidebarBackground || null,
        sidebarForeground: data.sidebarForeground || null,
      };
      await apiClient.patch('/tenants/config', payload);

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
      usePreferencesStore.getState().setPreferences({
        ...(data.dateFormat && { dateFormat: data.dateFormat }),
        ...(data.timeFormat && { timeFormat: data.timeFormat }),
        ...(data.timezone && { timezone: data.timezone }),
        ...(data.currency && { currency: data.currency }),
        ...(data.numberFormat && { numberFormat: data.numberFormat }),
        ...(data.currencyFormat && { currencyFormat: data.currencyFormat }),
      });

      setTheme(data.theme.toLowerCase());
      setLocale(data.language === 'INDONESIA' ? 'id' : 'en');

      toast.success('Preferences updated successfully');
    } catch (error) {
      console.error(error);
      toast.error('Failed to update preferences');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <PageContainer><DetailPageSkeleton /></PageContainer>;
  }

  return (
    <PageContainer>
      <PageHeader
        title="System Preferences"
        description="Configure your organization settings, branding, and regional preferences."
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardContent className="space-y-8 pt-6">
            {/* General Information */}
            <div className="space-y-5">
              <SectionHeader
                icon={<Building2 className="h-4 w-4 text-primary" />}
                title="General Information"
                description="Basic details about your organization."
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField label="Organization Name" error={errors.name?.message} required description="The display name for your tenant.">
                  <Input
                    {...register('name')}
                    error={!!errors.name}
                    placeholder="Acme Corporation"
                  />
                </FormField>
                <FormField label="Domain" error={errors.domain?.message} description="Custom domain for your tenant portal.">
                  <Input
                    {...register('domain')}
                    error={!!errors.domain}
                    placeholder="app.acme.com"
                  />
                </FormField>
                <div className="md:col-span-2">
                  <FormField label="Description" error={errors.description?.message} description="A brief description of your organization.">
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
                description="Customize the look and feel of your application."
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
                      <CardDescription>Override default brand colors for your organization.</CardDescription>
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground hidden sm:block">
              {isDirty ? 'You have unsaved changes.' : 'All changes saved.'}
            </p>
            <Button type="submit" isLoading={isSaving} className="gap-2 ml-auto">
              <Save className="h-4 w-4" />
              Save Changes
            </Button>
          </div>
        </div>
      </form>
    </PageContainer>
  );
}
