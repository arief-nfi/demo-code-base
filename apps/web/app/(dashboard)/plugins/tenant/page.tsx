'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Package, RefreshCw, Clock, Check } from 'lucide-react';
import { forbidden } from 'next/navigation';
import { toast } from 'sonner';
import {
  apiClient, ApiRequestError, ConfirmDialog, ListPageSkeleton, ErrorAlert,
  EmptyState, Badge, PageContainer, Button, Switch, formatMoney, useApi, useLanguage, useRBAC, useRBACStore, useAuthStore,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';
import { AppPreviewDialog, type StoreApp } from '@/components/app-preview-dialog';
import { appIcon } from '@/lib/app-icons';

interface Subscription {
  id: string;
  status: string;
  pricingModel: string;
  price: number | null;
  currency: string;
  startDate: string;
  endDate: string | null;
  trialEndsAt: string | null;
  cancelledAt: string | null;
}

interface Pricing {
  pricingModel: 'FREE' | 'MONTHLY' | 'YEARLY' | 'ONE_TIME';
  price: number | null;
  pricingCurrency: string;
  trialDays: number;
  pricingLabel: string | null;
}

interface Plugin {
  id: string;
  key: string;
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  authorEmail?: string;
  authorUrl?: string;
  isEnabled: boolean;
  pricing: Pricing;
  subscription: Subscription | null;
  /** Live apps of this tenant that include it: it isn't bought on its own then. */
  includedIn: Array<{ key: string; name: string }>;
}

interface BillingConfig {
  checkoutAvailable: boolean;
  tax: { enabled: boolean; name: string; rate: number };
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** "Rp 150.000/mo + PPN 11%" */
function priceText(pricing: Pricing, t: Translate, tax?: BillingConfig['tax']): string {
  const amount = formatMoney(Number(pricing.price) || 0, pricing.pricingCurrency || 'USD');
  const suffix = pricing.pricingModel === 'MONTHLY' ? t('billing.plugins.perMonth') : pricing.pricingModel === 'YEARLY' ? t('billing.plugins.perYear') : '';
  const taxNote = tax?.enabled ? ` + ${tax.name} ${tax.rate}%` : '';
  return `${amount}${suffix}${taxNote}`;
}

function getPricingBadge(pricing: Pricing, t: Translate, tax?: BillingConfig['tax']) {
  if (pricing.pricingModel === 'FREE') {
    return <Badge variant="success">{t('billing.model.FREE')}</Badge>;
  }
  const label = pricing.pricingLabel ? `${pricing.pricingLabel} — ` : '';
  return <Badge variant="default">{label}{priceText(pricing, t, tax)}</Badge>;
}

function getSubscriptionBadge(sub: Subscription | null, t: Translate) {
  if (!sub) return null;
  const owned = sub.status === 'ACTIVE' && sub.pricingModel === 'ONE_TIME';
  const status = owned ? 'OWNED' : sub.status;
  const variants: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
    ACTIVE: 'success',
    OWNED: 'success',
    TRIAL: 'warning',
    PAST_DUE: 'destructive',
    PAUSED: 'destructive',
  };
  return <Badge variant={variants[status] || 'outline'}>{t(`billing.statusLabel.${status}`)}</Badge>;
}

// Mirrors the API rule: one trial per plugin — a prior subscription with trialEndsAt set has used it
function canStartTrial(plugin: Plugin): boolean {
  return plugin.pricing.trialDays > 0 && !plugin.subscription?.trialEndsAt;
}

function getTrialCountdown(sub: Subscription | null, t: Translate): string | null {
  if (!sub || sub.status !== 'TRIAL' || !sub.trialEndsAt) return null;
  const remaining = new Date(sub.trialEndsAt).getTime() - Date.now();
  if (remaining <= 0) return t('billing.plugins.trialOver');
  return t('billing.trialDaysLeft', { days: Math.ceil(remaining / (1000 * 60 * 60 * 24)) });
}

export default function TenantPluginsPage() {
  const { t } = useLanguage();
  const { hasRole, isLoading: isRBACLoading } = useRBAC();
  const storedTenantName = useAuthStore(s => s.tenantName);
  const billingConfig = useApi<BillingConfig>('/billing/config', undefined, { skip: isRBACLoading });

  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [previewApp, setPreviewApp] = useState<StoreApp | null>(null);
  const [appBusy, setAppBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    pluginKey: string;
    pluginName: string;
    action: 'toggle-on' | 'toggle-off' | 'subscribe';
    message: string;
  }>({ isOpen: false, pluginKey: '', pluginName: '', action: 'toggle-on', message: '' });

  useEffect(() => {
    document.title = `Tenant Plugins | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  const fetchPlugins = async () => {
    if (isRBACLoading) return;
    try {
      setLoading(true);
      setError(null);
      const [data, store] = await Promise.all([
        apiClient.get<Plugin[]>('/tenant-plugins'),
        apiClient.get<StoreApp[]>('/tenant-apps'),
      ]);
      setPlugins(data);
      setApps(store);
    } catch (err) {
      console.warn('Failed to fetch plugins', err);
      setError('Failed to fetch plugins');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRBACLoading) fetchPlugins();
  }, [isRBACLoading]);

  if (isRBACLoading || loading) {
    return <PageContainer><ListPageSkeleton rows={3} cols={3} /></PageContainer>;
  }

  if (!hasRole('ADMIN')) {
    forbidden();
  }

  if (error) {
    return <PageContainer><ErrorAlert message={error} onRetry={fetchPlugins} /></PageContainer>;
  }

  const checkoutAvailable = billingConfig.data?.checkoutAvailable ?? false;
  const tax = billingConfig.data?.tax;

  const refreshRBAC = async () => {
    try {
      const me = await apiClient.get<{ roles: string[]; permissions: string[] }>('/auth/me');
      useRBACStore.getState().setRBAC(me.roles ?? [], me.permissions ?? []);
    } catch { /* non-critical */ }
  };

  // Determine what action to show for a plugin
  const getPluginAction = (plugin: Plugin) => {
    const sub = plugin.subscription;

    // Free plugin: use simple toggle
    if (plugin.pricing.pricingModel === 'FREE') {
      return { type: 'toggle' as const };
    }
    // A live app includes it: no subscription of its own, the tenant just switches it on or off
    if (plugin.includedIn?.length && !(sub && ['ACTIVE', 'TRIAL', 'PAST_DUE'].includes(sub.status))) {
      return { type: 'included' as const, app: plugin.includedIn[0].name };
    }
    // Paid and running (incl. grace period): managed on the Billing page
    if (sub && ['ACTIVE', 'TRIAL', 'PAST_DUE'].includes(sub.status)) {
      return { type: 'manage' as const };
    }
    // An unpaid invoice is waiting (first payment, or a paused plan)
    if (sub && ['PENDING_PAYMENT', 'PAUSED'].includes(sub.status)) {
      return { type: 'pay' as const };
    }
    const hasTrial = canStartTrial(plugin);
    return {
      type: 'subscribe' as const,
      label: hasTrial ? t('billing.plugins.startTrial', { days: plugin.pricing.trialDays }) : t('billing.plugins.subscribe'),
      // Paid plugins (trials included) need a payment provider
      unavailable: !checkoutAvailable,
    };
  };

  /**
   * Subscribe to a plugin or an app (`app:<key>`), or re-open the waiting invoice, and go to the
   * payment page if there is something to pay. Plugins of an app that couldn't be switched on are reported.
   */
  const subscribe = async (productKey: string) => {
    const { checkoutUrl, failedPlugins } = await apiClient.post<{ checkoutUrl: string | null; failedPlugins?: string[] }>(
      `/billing/subscriptions/${encodeURIComponent(productKey)}`,
    );
    if (checkoutUrl) {
      setRedirecting(true);
      window.location.assign(checkoutUrl);
      return true;
    }
    if (failedPlugins?.length) toast.warning(t('apps.store.failedPlugins', { plugins: failedPlugins.join(', ') }));
    return false;
  };

  const appPricing = (app: StoreApp): Pricing => ({
    pricingModel: app.pricing.pricingModel,
    price: app.pricing.price != null ? Number(app.pricing.price) : null,
    pricingCurrency: app.pricing.currency,
    trialDays: app.pricing.trialDays,
    pricingLabel: app.pricing.pricingLabel,
  });

  const buyApp = async () => {
    if (!previewApp) return;
    setAppBusy(true);
    try {
      if (await subscribe(`app:${previewApp.key}`)) return;
      setPreviewApp(null);
      await refreshRBAC();
      fetchPlugins();
      window.dispatchEvent(new Event('plugins-updated'));
      toast.success(t('billing.plugins.subscribed'));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('common.error'));
    } finally {
      setAppBusy(false);
    }
  };

  const payApp = async (app: StoreApp) => {
    try {
      await subscribe(`app:${app.key}`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('common.error'));
    }
  };

  const handleAction = async (plugin: Plugin) => {
    const action = getPluginAction(plugin);

    if (action.type === 'toggle' || action.type === 'included') {
      setConfirmDialog({
        isOpen: true,
        pluginKey: plugin.key,
        pluginName: plugin.name,
        action: plugin.isEnabled ? 'toggle-off' : 'toggle-on',
        message: `Are you sure you want to ${plugin.isEnabled ? 'disable' : 'enable'} "${plugin.name}"?`,
      });
    } else if (action.type === 'subscribe') {
      const price = priceText(plugin.pricing, t, tax);
      setConfirmDialog({
        isOpen: true,
        pluginKey: plugin.key,
        pluginName: plugin.name,
        action: 'subscribe',
        message: canStartTrial(plugin)
          ? t('billing.plugins.trialConfirm', { plugin: plugin.name, days: plugin.pricing.trialDays, price })
          : t('billing.plugins.subscribeConfirm', { plugin: plugin.name, price }),
      });
    } else if (action.type === 'pay') {
      try {
        await subscribe(plugin.key);
      } catch (err) {
        toast.error(err instanceof ApiRequestError ? err.message : t('common.error'));
      }
    }
  };

  const executeAction = async () => {
    const { pluginKey, action } = confirmDialog;
    try {
      if (action === 'toggle-on' || action === 'toggle-off') {
        await apiClient.post(`/tenant-plugins/${pluginKey}/toggle`, { isEnabled: action === 'toggle-on' });
      } else if (action === 'subscribe') {
        if (await subscribe(pluginKey)) return;
      }

      await refreshRBAC();
      fetchPlugins();
      window.dispatchEvent(new Event('plugins-updated'));

      const messages: Record<string, string> = {
        'toggle-on': 'Plugin enabled',
        'toggle-off': 'Plugin disabled',
        'subscribe': t('billing.plugins.subscribed'),
      };
      toast.success(messages[action] || 'Done');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      toast.error(message);
    } finally {
      setConfirmDialog({ isOpen: false, pluginKey: '', pluginName: '', action: 'toggle-on', message: '' });
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Tenant Plugins"
        description={t('billing.plugins.pageDescription')}
      >
        <Button variant="ghost" size="icon" onClick={fetchPlugins} title="Refresh plugins">
          <RefreshCw className="h-5 w-5" />
        </Button>
      </PageHeader>

      {apps.length > 0 && (
        <section className="mb-8 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('apps.store.sectionTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('apps.store.sectionHelp')}</p>
          </div>
          <div className="grid gap-4">
            {apps.map((app) => {
              const Icon = appIcon(app.icon);
              const sub = app.subscription;
              const running = sub && ['ACTIVE', 'TRIAL', 'PAST_DUE'].includes(sub.status);
              const waiting = sub && ['PENDING_PAYMENT', 'PAUSED'].includes(sub.status);
              const paid = app.pricing.pricingModel !== 'FREE';
              return (
                <div key={app.key} className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-card p-6 text-card-foreground shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="rounded-full bg-primary/10 p-3">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-medium text-foreground">{app.name}</h3>
                        {getPricingBadge(appPricing(app), t, tax)}
                        {app.savingPercent != null && <Badge variant="success">{t('apps.store.save', { percent: app.savingPercent })}</Badge>}
                        {sub && sub.status !== 'ENDED' && getSubscriptionBadge({ status: sub.status, pricingModel: app.pricing.pricingModel } as Subscription, t)}
                      </div>
                      {app.description && <p className="text-sm text-muted-foreground">{app.description}</p>}
                      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {app.plugins.map((p) => (
                          <li key={p.key} className="flex items-center gap-1">
                            {p.owned ? <Check className="h-3.5 w-3.5 text-success" /> : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />}
                            {p.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {running ? (
                      <Link href="/billing">
                        <Button variant="outline" size="sm">{t('billing.plugins.manage')}</Button>
                      </Link>
                    ) : waiting ? (
                      <Button size="sm" disabled={redirecting || !checkoutAvailable} onClick={() => payApp(app)}>{t('billing.pay')}</Button>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <Button size="sm" disabled={redirecting || (paid && !checkoutAvailable)} onClick={() => setPreviewApp(app)}>
                          {app.canStartTrial ? t('billing.plugins.startTrial', { days: app.pricing.trialDays }) : t('billing.plugins.subscribe')}
                        </Button>
                        {paid && !checkoutAvailable && <span className="text-xs text-muted-foreground">{t('billing.plugins.unavailable')}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <h2 className="pt-2 text-lg font-semibold">{t('apps.store.pluginsTitle')}</h2>
        </section>
      )}

      {plugins.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" />}
          title="No plugins available"
          description="No plugins are available for your tenant yet."
        />
      ) : (
        <div className="grid gap-4">
          {plugins.map((plugin) => {
            const action = getPluginAction(plugin);
            const trialCountdown = getTrialCountdown(plugin.subscription, t);

            return (
              <div key={plugin.key} className="flex items-center justify-between rounded-lg bg-card p-6 text-card-foreground border border-border shadow-sm transition-all duration-150 hover:shadow-md">
                <div className="flex items-center space-x-4">
                  <div className="rounded-full bg-primary/10 p-3">
                    <Package className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-medium text-foreground">{plugin.name}</h3>
                      {plugin.version && <Badge variant="outline">v{plugin.version}</Badge>}
                      {getPricingBadge(plugin.pricing, t, tax)}
                      {getSubscriptionBadge(plugin.subscription, t)}
                    </div>
                    <p className="text-sm text-muted-foreground">{plugin.description}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {plugin.authorName && (
                        <p className="text-xs text-muted-foreground">
                          By {plugin.authorUrl ? (
                            <a href={plugin.authorUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary underline">
                              {plugin.authorName}
                            </a>
                          ) : plugin.authorName}
                        </p>
                      )}
                      {trialCountdown && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <Clock className="h-3 w-3" /> {trialCountdown}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {action.type === 'included' && (
                    <>
                      <span className="text-xs text-muted-foreground">{t('apps.store.includedIn', { app: action.app })}</span>
                      <Switch checked={plugin.isEnabled} onCheckedChange={() => handleAction(plugin)} />
                    </>
                  )}
                  {action.type === 'toggle' && (
                    <>
                      <Badge variant={plugin.isEnabled ? 'success' : 'destructive'}>
                        {plugin.isEnabled ? 'Active' : 'Inactive'}
                      </Badge>
                      <Switch
                        checked={plugin.isEnabled}
                        onCheckedChange={() => handleAction(plugin)}
                      />
                    </>
                  )}
                  {action.type === 'subscribe' && (
                    <div className="flex flex-col items-end gap-1">
                      <Button size="sm" disabled={action.unavailable || redirecting} onClick={() => handleAction(plugin)}>
                        {action.label}
                      </Button>
                      {action.unavailable && (
                        <span className="text-xs text-muted-foreground">{t('billing.plugins.unavailable')}</span>
                      )}
                    </div>
                  )}
                  {action.type === 'pay' && (
                    <Button size="sm" disabled={redirecting || !checkoutAvailable} onClick={() => handleAction(plugin)}>
                      {t('billing.pay')}
                    </Button>
                  )}
                  {action.type === 'manage' && (
                    <Link href="/billing">
                      <Button variant="outline" size="sm">{t('billing.plugins.manage')}</Button>
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AppPreviewDialog
        app={previewApp}
        priceText={previewApp ? (previewApp.pricing.pricingModel === 'FREE' ? t('billing.model.FREE') : priceText(appPricing(previewApp), t, tax)) : ''}
        busy={appBusy || redirecting}
        onClose={() => setPreviewApp(null)}
        onConfirm={buyApp}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, pluginKey: '', pluginName: '', action: 'toggle-on', message: '' })}
        onConfirm={executeAction}
        title={
          confirmDialog.action === 'subscribe' ? t('billing.plugins.subscribeTitle') :
          confirmDialog.action === 'toggle-on' ? 'Enable Plugin' : 'Disable Plugin'
        }
        description={confirmDialog.message}
        confirmText={
          confirmDialog.action === 'subscribe' ? t('billing.plugins.subscribe') :
          confirmDialog.action === 'toggle-on' ? 'Enable' : 'Disable'
        }
        cancelText="Cancel"
        variant={confirmDialog.action === 'toggle-off' ? 'destructive' : undefined}
      />
    </PageContainer>
  );
}
