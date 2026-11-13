'use client';

import { useState, useEffect } from 'react';
import { Package, RefreshCw, DollarSign } from 'lucide-react';
import { forbidden } from 'next/dist/client/components/navigation';
import { toast } from 'sonner';
import {
  apiClient, ConfirmDialog, ListPageSkeleton, ErrorAlert,
  EmptyState, Badge, PageContainer, Button, Switch, Input, Label, useRBAC, useAuthStore,
  DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';

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
  pricingModel: 'FREE' | 'MONTHLY' | 'YEARLY' | 'ONE_TIME';
  price: number | null;
  pricingCurrency: string;
  trialDays: number;
  pricingLabel: string | null;
}

function getPricingBadge(plugin: Plugin) {
  if (plugin.pricingModel === 'FREE') {
    return <Badge variant="success">Free</Badge>;
  }
  const price = Number(plugin.price) || 0;
  const currency = plugin.pricingCurrency || 'USD';
  const suffix = plugin.pricingModel === 'MONTHLY' ? '/mo' : plugin.pricingModel === 'YEARLY' ? '/yr' : '';
  const label = plugin.pricingLabel ? `${plugin.pricingLabel} — ` : '';
  return (
    <Badge variant="default">
      {label}{currency} {price.toFixed(2)}{suffix}
    </Badge>
  );
}

export default function InstalledPluginsPage() {
  const { hasRole, isLoading: isRBACLoading } = useRBAC();
  const storedTenantName = useAuthStore(s => s.tenantName);

  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    pluginKey: string;
    pluginName: string;
    currentState: boolean;
  }>({ isOpen: false, pluginKey: '', pluginName: '', currentState: false });

  // Pricing dialog state
  const [pricingDialog, setPricingDialog] = useState<{
    isOpen: boolean;
    plugin: Plugin | null;
  }>({ isOpen: false, plugin: null });
  const [pricingForm, setPricingForm] = useState({
    pricingModel: 'FREE' as string,
    price: '',
    pricingCurrency: 'USD',
    trialDays: '0',
    pricingLabel: '',
  });
  const [pricingSaving, setPricingSaving] = useState(false);

  useEffect(() => {
    document.title = `Installed Plugins | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  const fetchPlugins = async () => {
    if (isRBACLoading) return;
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get<Plugin[]>('/plugins');
      setPlugins(data);
    } catch (err) {
      console.warn('Failed to fetch plugins', err);
      setError('Failed to fetch plugins');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRBACLoading) {
      fetchPlugins();
    }
  }, [isRBACLoading]);

  if (isRBACLoading || loading) {
    return <PageContainer><ListPageSkeleton rows={3} cols={3} /></PageContainer>;
  }

  if (!hasRole('SYSADMIN')) {
    forbidden();
  }

  if (error) {
    return <PageContainer><ErrorAlert message={error} onRetry={fetchPlugins} /></PageContainer>;
  }

  const handleToggleClick = (plugin: Plugin) => {
    setConfirmDialog({
      isOpen: true,
      pluginKey: plugin.key,
      pluginName: plugin.name,
      currentState: plugin.isEnabled,
    });
  };

  const togglePlugin = async () => {
    const { pluginKey, currentState } = confirmDialog;
    try {
      await apiClient.post(`/plugins/${pluginKey}/toggle`, { isEnabled: !currentState });
      fetchPlugins();
      window.dispatchEvent(new Event('plugins-updated'));
      toast.success(`Plugin ${!currentState ? 'enabled' : 'disabled'} successfully`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred while toggling plugin';
      toast.error(message);
    } finally {
      setConfirmDialog({ isOpen: false, pluginKey: '', pluginName: '', currentState: false });
    }
  };

  const openPricingDialog = (plugin: Plugin) => {
    setPricingForm({
      pricingModel: plugin.pricingModel || 'FREE',
      price: plugin.price != null ? String(plugin.price) : '',
      pricingCurrency: plugin.pricingCurrency || 'USD',
      trialDays: String(plugin.trialDays || 0),
      pricingLabel: plugin.pricingLabel || '',
    });
    setPricingDialog({ isOpen: true, plugin });
  };

  const savePricing = async () => {
    if (!pricingDialog.plugin) return;
    setPricingSaving(true);
    try {
      await apiClient.patch(`/plugins/${pricingDialog.plugin.key}/pricing`, {
        pricingModel: pricingForm.pricingModel,
        price: pricingForm.pricingModel === 'FREE' ? null : Number(pricingForm.price) || 0,
        pricingCurrency: pricingForm.pricingCurrency,
        trialDays: pricingForm.pricingModel === 'FREE' ? 0 : Number(pricingForm.trialDays) || 0,
        pricingLabel: pricingForm.pricingLabel || null,
      });
      toast.success('Pricing updated');
      setPricingDialog({ isOpen: false, plugin: null });
      fetchPlugins();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update pricing';
      toast.error(message);
    } finally {
      setPricingSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Installed Plugins"
        description="Manage system-wide plugins and pricing. Disabling a plugin here removes it for all tenants."
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={fetchPlugins}
          title="Refresh plugins"
        >
          <RefreshCw className="h-5 w-5" />
        </Button>
      </PageHeader>

      {plugins.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" />}
          title="No plugins installed"
          description="No plugins have been registered in the system yet."
        />
      ) : (
        <div className="grid gap-4">
          {plugins.map((plugin) => (
            <div key={plugin.key} className="flex items-center justify-between rounded-lg bg-card p-6 text-card-foreground border border-border shadow-sm transition-all duration-150 hover:shadow-md">
              <div className="flex items-center space-x-4">
                <div className="rounded-full bg-primary/10 p-3">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium text-foreground">{plugin.name}</h3>
                    {plugin.version && <Badge variant="outline">v{plugin.version}</Badge>}
                    {getPricingBadge(plugin)}
                    {plugin.trialDays > 0 && plugin.pricingModel !== 'FREE' && (
                      <Badge variant="outline">{plugin.trialDays}-day trial</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{plugin.description}</p>
                  {plugin.authorName && (
                    <p className="text-xs text-muted-foreground mt-1">
                      By {plugin.authorUrl ? (
                        <a href={plugin.authorUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary underline">
                          {plugin.authorName}
                        </a>
                      ) : plugin.authorName}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openPricingDialog(plugin)}
                  className="gap-1.5"
                >
                  <DollarSign className="h-3.5 w-3.5" /> Pricing
                </Button>
                <Badge variant={plugin.isEnabled ? 'success' : 'destructive'}>
                  {plugin.isEnabled ? 'Active' : 'Inactive'}
                </Badge>
                <Switch
                  checked={plugin.isEnabled}
                  onCheckedChange={() => handleToggleClick(plugin)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, pluginKey: '', pluginName: '', currentState: false })}
        onConfirm={togglePlugin}
        title={`${confirmDialog.currentState ? 'Disable' : 'Enable'} Plugin`}
        description={`Are you sure you want to ${confirmDialog.currentState ? 'disable' : 'enable'} the plugin "${confirmDialog.pluginName}"? This will affect all tenants.`}
        confirmText={confirmDialog.currentState ? 'Disable' : 'Enable'}
        cancelText="Cancel"
      />

      {/* Pricing Configuration Dialog */}
      <DialogRoot open={pricingDialog.isOpen} onOpenChange={(open) => !open && setPricingDialog({ isOpen: false, plugin: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Pricing — {pricingDialog.plugin?.name}</DialogTitle>
            <DialogDescription>Set the pricing model for this plugin. Tenants will see this when browsing available plugins.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 px-6">
            <div className="space-y-1.5">
              <Label>Pricing Model</Label>
              <select
                value={pricingForm.pricingModel}
                onChange={(e) => setPricingForm({ ...pricingForm, pricingModel: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="FREE">Free</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
                <option value="ONE_TIME">One-Time</option>
              </select>
            </div>

            {pricingForm.pricingModel !== 'FREE' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Price</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pricingForm.price}
                      onChange={(e) => setPricingForm({ ...pricingForm, price: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Currency</Label>
                    <select
                      value={pricingForm.pricingCurrency}
                      onChange={(e) => setPricingForm({ ...pricingForm, pricingCurrency: e.target.value })}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="USD">USD</option>
                      <option value="IDR">IDR</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Trial Days</Label>
                    <Input
                      type="number"
                      min="0"
                      value={pricingForm.trialDays}
                      onChange={(e) => setPricingForm({ ...pricingForm, trialDays: e.target.value })}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">0 = no trial. Tenants must wait for sysadmin approval.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Pricing Label</Label>
                    <Input
                      value={pricingForm.pricingLabel}
                      onChange={(e) => setPricingForm({ ...pricingForm, pricingLabel: e.target.value })}
                      placeholder="e.g., Pro, Premium"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPricingDialog({ isOpen: false, plugin: null })}>
              Cancel
            </Button>
            <Button onClick={savePricing} disabled={pricingSaving}>
              {pricingSaving ? 'Saving...' : 'Save Pricing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </PageContainer>
  );
}
