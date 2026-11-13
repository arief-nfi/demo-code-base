'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LayoutGrid, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { forbidden } from 'next/dist/client/components/navigation';
import { toast } from 'sonner';
import {
  apiClient, Badge, Button, Checkbox, ConfirmDialog, EmptyState, ErrorAlert, Input, Label, ListPageSkeleton, PageContainer,
  Select, Switch, Textarea, formatMoney, useAuthStore, useLanguage, useRBAC,
  DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';
import { APP_ICONS, appIcon, type AppIcon } from '@/lib/app-icons';

type PricingModel = 'FREE' | 'MONTHLY' | 'YEARLY' | 'ONE_TIME';

interface AppRow {
  key: string;
  name: string;
  description: string | null;
  icon: string;
  isPublished: boolean;
  pricingModel: PricingModel;
  price: string | null;
  pricingCurrency: string;
  trialDays: number;
  pricingLabel: string | null;
  plugins: string[];
  liveSubscribers: number;
  /** Plugins added to the app that couldn't be switched on for a subscriber, while still off. */
  switchOnFailures: Array<{ tenantSlug: string; pluginKey: string; pluginName: string; error: string; at: string }>;
}

interface PluginOption {
  key: string;
  name: string;
  pricingModel: PricingModel;
  price: string | null;
  currency: string;
  dependencies: string[];
}

interface Quote {
  missingDependencies: string[];
  sumOfParts: string | null;
  savingPercent: number | null;
}

interface FormState {
  key: string;
  name: string;
  description: string;
  icon: AppIcon;
  plugins: string[];
  pricingModel: PricingModel;
  price: string;
  pricingCurrency: 'USD' | 'IDR';
  trialDays: string;
  pricingLabel: string;
  isPublished: boolean;
}

const EMPTY_FORM: FormState = {
  key: '', name: '', description: '', icon: 'package', plugins: [], pricingModel: 'MONTHLY', price: '',
  pricingCurrency: 'IDR', trialDays: '0', pricingLabel: '', isPublished: false,
};

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export default function AppsPage() {
  const { t } = useLanguage();
  const { hasRole, isLoading: isRBACLoading } = useRBAC();
  const storedTenantName = useAuthStore((s) => s.tenantName);

  const [apps, setApps] = useState<AppRow[]>([]);
  const [options, setOptions] = useState<PluginOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<AppRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<{ title: string; message: string } | null>(null);
  const [deleting, setDeleting] = useState<AppRow | null>(null);

  useEffect(() => {
    document.title = `${t('apps.admin.title')} | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName, t]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, plugins] = await Promise.all([
        apiClient.get<AppRow[]>('/apps'),
        apiClient.get<PluginOption[]>('/apps/plugin-options'),
      ]);
      setApps(list);
      setOptions(plugins);
    } catch (err) {
      setError(message(err, t('apps.admin.loadError')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // A boolean, not hasRole itself: useRBAC returns a new function on every render
  const isSysadmin = hasRole('SYSADMIN');
  useEffect(() => {
    if (!isRBACLoading && isSysadmin) load();
  }, [isRBACLoading, isSysadmin, load]);

  // Missing dependencies and the saving, while the form changes
  useEffect(() => {
    if (!formOpen) return;
    const timer = setTimeout(() => {
      apiClient
        .post<Quote>('/apps/quote', {
          plugins: form.plugins,
          pricingModel: form.pricingModel,
          price: form.pricingModel === 'FREE' || form.price === '' ? null : Number(form.price),
          pricingCurrency: form.pricingCurrency,
        })
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [formOpen, form.plugins, form.pricingModel, form.price, form.pricingCurrency]);

  const names = useMemo(() => new Map(options.map((p) => [p.key, p.name])), [options]);
  const nameList = (keys: string[]) => keys.map((key) => names.get(key) ?? key).join(', ');

  if (isRBACLoading || (loading && !error)) {
    return <PageContainer><ListPageSkeleton rows={3} cols={3} /></PageContainer>;
  }
  if (!hasRole('SYSADMIN')) forbidden();
  if (error) {
    return <PageContainer><ErrorAlert message={error} onRetry={load} /></PageContainer>;
  }

  const priceText = (app: Pick<AppRow, 'pricingModel' | 'price' | 'pricingCurrency'>) => {
    if (app.pricingModel === 'FREE') return t('billing.model.FREE');
    const suffix = app.pricingModel === 'MONTHLY' ? t('billing.plugins.perMonth') : app.pricingModel === 'YEARLY' ? t('billing.plugins.perYear') : '';
    return `${formatMoney(Number(app.price) || 0, app.pricingCurrency)}${suffix}`;
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setQuote(null);
    setFormOpen(true);
  };

  const openEdit = (app: AppRow) => {
    setEditing(app);
    setForm({
      key: app.key,
      name: app.name,
      description: app.description ?? '',
      icon: (APP_ICONS as string[]).includes(app.icon) ? (app.icon as AppIcon) : 'package',
      plugins: app.plugins,
      pricingModel: app.pricingModel,
      price: app.price ?? '',
      pricingCurrency: app.pricingCurrency === 'USD' ? 'USD' : 'IDR',
      trialDays: String(app.trialDays),
      pricingLabel: app.pricingLabel ?? '',
      isPublished: app.isPublished,
    });
    setQuote(null);
    setFormOpen(true);
  };

  const togglePlugin = (key: string, on: boolean) =>
    setForm((f) => ({ ...f, plugins: on ? [...f.plugins, key] : f.plugins.filter((k) => k !== key) }));

  const addMissing = () =>
    setForm((f) => ({ ...f, plugins: [...f.plugins, ...(quote?.missingDependencies ?? []).filter((k) => !f.plugins.includes(k))] }));

  const save = async () => {
    setSaving(true);
    const body = {
      name: form.name,
      description: form.description || null,
      icon: form.icon,
      plugins: form.plugins,
      pricingModel: form.pricingModel,
      price: form.pricingModel === 'FREE' ? null : form.price === '' ? null : Number(form.price),
      pricingCurrency: form.pricingCurrency,
      trialDays: form.pricingModel === 'FREE' ? 0 : Number(form.trialDays) || 0,
      pricingLabel: form.pricingLabel || null,
      isPublished: form.isPublished,
    };
    try {
      if (editing) {
        await apiClient.put(`/apps/${editing.key}`, body);
        toast.success(t('apps.admin.saved'));
      } else {
        await apiClient.post('/apps', { key: form.key, ...body });
        toast.success(t('apps.admin.created'));
      }
      setFormOpen(false);
      load();
    } catch (err) {
      toast.error(message(err, t('apps.admin.saveError')));
    } finally {
      setSaving(false);
    }
  };

  // Ask before giving paid plugins away, and before taking plugins from tenants who have the app
  const confirmSave = () => {
    const paidIncluded = form.plugins.some((key) => options.find((p) => p.key === key)?.pricingModel !== 'FREE');
    if (form.pricingModel === 'FREE' && paidIncluded) {
      setWarning({ title: t('apps.admin.freeWarningTitle'), message: t('apps.admin.freeWarning') });
      return;
    }
    const removed = editing ? editing.plugins.filter((key) => !form.plugins.includes(key)) : [];
    if (editing && removed.length && editing.liveSubscribers > 0) {
      setWarning({
        title: t('apps.admin.removeWarningTitle', { app: editing.name }),
        message: t('apps.admin.removeWarning', { count: editing.liveSubscribers, plugins: nameList(removed) }),
      });
      return;
    }
    save();
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiClient.delete(`/apps/${deleting.key}`);
      toast.success(t('apps.admin.deleted'));
      load();
    } catch (err) {
      toast.error(message(err, t('apps.admin.deleteError')));
    } finally {
      setDeleting(null);
    }
  };

  const modelOptions = (['FREE', 'MONTHLY', 'YEARLY', 'ONE_TIME'] as const).map((value) => ({ value, label: t(`billing.model.${value}`) }));
  const iconOptions = APP_ICONS.map((value) => ({ value, label: value }));
  const SelectedIcon = appIcon(form.icon);

  return (
    <PageContainer>
      <PageHeader title={t('apps.admin.title')} description={t('apps.admin.description')}>
        <Button variant="ghost" size="icon" onClick={load} title={t('apps.admin.refresh')}>
          <RefreshCw className="h-5 w-5" />
        </Button>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t('apps.admin.newApp')}
        </Button>
      </PageHeader>

      {apps.length === 0 ? (
        <EmptyState icon={<LayoutGrid className="h-8 w-8" />} title={t('apps.admin.empty')} description={t('apps.admin.emptyHelp')} />
      ) : (
        <div className="grid gap-4">
          {apps.map((app) => {
            const Icon = appIcon(app.icon);
            return (
              <div key={app.key} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className="rounded-full bg-primary/10 p-3">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-medium text-foreground">{app.name}</h3>
                      <Badge variant="outline">{app.key}</Badge>
                      <Badge variant="default">{priceText(app)}</Badge>
                      <Badge variant={app.isPublished ? 'success' : 'outline'}>{t(app.isPublished ? 'apps.admin.published' : 'apps.admin.hidden')}</Badge>
                    </div>
                    {app.description && <p className="text-sm text-muted-foreground">{app.description}</p>}
                    <p className="text-sm">{nameList(app.plugins)}</p>
                    <p className="text-xs text-muted-foreground">{t('apps.admin.subscribers', { count: app.liveSubscribers })}</p>
                    {app.switchOnFailures.length > 0 && (
                      <div className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                        <p className="flex items-center gap-1.5 font-medium">
                          <AlertTriangle className="h-4 w-4" /> {t('apps.admin.switchOnFailuresTitle')}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {app.switchOnFailures.map((f) => (
                            <li key={`${f.tenantSlug}:${f.pluginKey}`}>
                              {t('apps.admin.switchOnFailure', { tenant: f.tenantSlug, plugin: f.pluginName, error: f.error })}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-xs">{t('apps.admin.switchOnFailuresHelp')}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(app)}>
                    <Pencil className="h-3.5 w-3.5" /> {t('apps.admin.edit')}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDeleting(app)}>
                    <Trash2 className="h-3.5 w-3.5" /> {t('apps.admin.delete')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DialogRoot open={formOpen} onOpenChange={(open) => !open && setFormOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t('apps.admin.editTitle', { app: editing.name }) : t('apps.admin.createTitle')}</DialogTitle>
            <DialogDescription>{t('apps.admin.formHelp')}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="app-key">{t('apps.admin.key')}</Label>
                <Input id="app-key" value={form.key} disabled={!!editing} placeholder="warehouse"
                  onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })} />
                {!editing && <p className="text-xs text-muted-foreground">{t('apps.admin.keyHelp')}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app-name">{t('apps.admin.name')}</Label>
                <Input id="app-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="app-description">{t('apps.admin.descriptionLabel')}</Label>
                <Textarea id="app-description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('apps.admin.icon')}</Label>
                <div className="flex items-center gap-2">
                  <SelectedIcon className="h-5 w-5 text-primary" />
                  <Select className="w-44" value={form.icon} options={iconOptions} onChange={(value) => setForm({ ...form, icon: value as AppIcon })} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('apps.admin.plugins')}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map((plugin) => (
                  <label key={plugin.key} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <Checkbox checked={form.plugins.includes(plugin.key)} onChange={(e) => togglePlugin(plugin.key, e.target.checked)} />
                    <span className="flex-1">{plugin.name}</span>
                    <span className="text-xs text-muted-foreground">{priceText({ pricingModel: plugin.pricingModel, price: plugin.price, pricingCurrency: plugin.currency })}</span>
                  </label>
                ))}
              </div>
              {quote && quote.missingDependencies.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-warning">
                  <span>{t('apps.admin.needs', { plugins: nameList(quote.missingDependencies) })}</span>
                  <Button variant="outline" size="sm" onClick={addMissing}>{t('apps.admin.addMissing')}</Button>
                </div>
              )}
              {quote?.sumOfParts && (
                <p className="text-sm text-muted-foreground">
                  {t('apps.admin.sumOfParts', { amount: formatMoney(Number(quote.sumOfParts), form.pricingCurrency) })}
                  {quote.savingPercent != null && <> · <span className="font-medium text-success">{t('apps.admin.saving', { percent: quote.savingPercent })}</span></>}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t('apps.admin.pricingModel')}</Label>
                <Select value={form.pricingModel} options={modelOptions} onChange={(value) => setForm({ ...form, pricingModel: value as PricingModel })} />
              </div>
              {form.pricingModel !== 'FREE' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="app-price">{t('apps.admin.price')}</Label>
                    <Input id="app-price" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('apps.admin.currency')}</Label>
                    <Select value={form.pricingCurrency} options={[{ value: 'IDR', label: 'IDR' }, { value: 'USD', label: 'USD' }]}
                      onChange={(value) => setForm({ ...form, pricingCurrency: value as 'USD' | 'IDR' })} />
                  </div>
                </>
              )}
            </div>
            {form.pricingModel !== 'FREE' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="app-trial">{t('apps.admin.trialDays')}</Label>
                  <Input id="app-trial" type="number" min="0" value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
                  <p className="text-xs text-muted-foreground">{t('apps.admin.trialHelp')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="app-label">{t('apps.admin.pricingLabel')}</Label>
                  <Input id="app-label" value={form.pricingLabel} onChange={(e) => setForm({ ...form, pricingLabel: e.target.value })} />
                </div>
              </div>
            )}

            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block font-medium">{t('apps.admin.published')}</span>
                <span className="block text-sm text-muted-foreground">{t('apps.admin.publishedHelp')}</span>
              </span>
              <Switch checked={form.isPublished} onCheckedChange={(value) => setForm({ ...form, isPublished: value })} aria-label={t('apps.admin.published')} />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>{t('apps.admin.cancel')}</Button>
            <Button onClick={confirmSave} disabled={saving || !form.name || (!editing && !form.key) || form.plugins.length === 0}>
              {saving ? t('apps.admin.savingNow') : t('apps.admin.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <ConfirmDialog
        isOpen={warning !== null}
        onClose={() => setWarning(null)}
        onConfirm={() => {
          setWarning(null);
          save();
        }}
        title={warning?.title ?? ''}
        description={warning?.message ?? ''}
        confirmText={t('apps.admin.continue')}
        cancelText={t('apps.admin.cancel')}
      />

      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={t('apps.admin.deleteTitle')}
        description={t('apps.admin.deleteMessage', { app: deleting?.name ?? '' })}
        confirmText={t('apps.admin.delete')}
        cancelText={t('apps.admin.cancel')}
        variant="destructive"
      />
    </PageContainer>
  );
}
