'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  apiClient, Button, Spinner, formatDate, formatMoney, useLanguage,
  DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@saas/ui';

export interface StoreApp {
  key: string;
  name: string;
  description: string | null;
  icon: string;
  pricing: { pricingModel: 'FREE' | 'MONTHLY' | 'YEARLY' | 'ONE_TIME'; price: string | null; currency: string; trialDays: number; pricingLabel: string | null };
  savingPercent: number | null;
  plugins: Array<{ key: string; name: string; owned: boolean }>;
  subscription: { status: string; displayStatus: string; trialEndsAt: string | null; currentPeriodEnd: string | null; openInvoiceId: string | null } | null;
  canStartTrial: boolean;
}

type Action = 'end-with-credit' | 'stop-renewing' | 'keep-owned' | 'end' | 'none';

interface AppPreview {
  app: StoreApp;
  plugins: Array<{ key: string; name: string; action: Action; creditEstimate: string | null; currentPeriodEnd: string | null }>;
  overlaps: Array<{ pluginKey: string; pluginName: string; appName: string }>;
  creditBalance: string;
}

interface Props {
  app: StoreApp | null;
  /** "Rp 200.000/mo + PPN 11%" */
  priceText: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** Before buying an app: what it includes and what happens to the plugins the tenant already pays for. */
export function AppPreviewDialog({ app, priceText, busy, onClose, onConfirm }: Props) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<AppPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!app) return;
    setPreview(null);
    setError(null);
    apiClient
      .get<AppPreview>(`/tenant-apps/${encodeURIComponent(app.key)}/preview`)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : t('apps.store.previewError')));
  }, [app, t]);

  const money = (amount: string) => formatMoney(amount, app?.pricing.currency ?? 'USD');

  const actionText = (p: AppPreview['plugins'][number]): string | null => {
    switch (p.action) {
      case 'end-with-credit':
        return p.creditEstimate && Number(p.creditEstimate) > 0
          ? t('apps.store.action.endWithCredit', { amount: money(p.creditEstimate) })
          : t('apps.store.action.endWithoutCredit');
      case 'stop-renewing':
        return t('apps.store.action.stopRenewing', { date: p.currentPeriodEnd ? formatDate(p.currentPeriodEnd) : '—' });
      case 'keep-owned':
        return t('apps.store.action.keepOwned');
      case 'end':
        return t('apps.store.action.end');
      default:
        return null;
    }
  };

  const trial = app?.canStartTrial ? app.pricing.trialDays : 0;

  return (
    <DialogRoot open={app !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('apps.store.previewTitle', { app: app?.name ?? '' })}</DialogTitle>
          <DialogDescription>{app?.description ?? ''}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4 text-sm">
          {error && <p className="text-destructive">{error}</p>}
          {!preview && !error && (
            <div className="flex items-center gap-2 text-muted-foreground"><Spinner size="sm" /> {t('apps.store.previewLoading')}</div>
          )}
          {preview && (
            <>
              <div>
                <p className="mb-2 font-medium">{t('apps.store.includesTitle', { app: preview.app.name })}</p>
                <ul className="space-y-2">
                  {preview.plugins.map((p) => {
                    const note = actionText(p);
                    return (
                      <li key={p.key}>
                        <span className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" /> {p.name}
                        </span>
                        {note && <span className="ml-6 block text-muted-foreground">{note}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
              {preview.overlaps.map((o) => (
                <p key={`${o.pluginKey}-${o.appName}`} className="rounded-md bg-warning/10 px-3 py-2 text-warning">
                  {t('apps.store.overlap', { plugin: o.pluginName, app: o.appName })}
                </p>
              ))}
              {Number(preview.creditBalance) > 0 && (
                <p className="text-muted-foreground">{t('apps.store.creditBalance', { amount: money(preview.creditBalance) })}</p>
              )}
              <p className="font-medium">
                {trial > 0 ? t('apps.store.trialThen', { days: trial, price: priceText }) : t('apps.store.price', { price: priceText })}
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('apps.store.cancel')}</Button>
          <Button onClick={onConfirm} disabled={busy || !preview}>
            {trial > 0 ? t('billing.plugins.startTrial', { days: trial }) : t('billing.plugins.subscribe')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
