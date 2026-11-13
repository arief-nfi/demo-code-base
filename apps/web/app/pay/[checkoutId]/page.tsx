'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { API_URL, Button, Spinner, cn, formatDate, formatMoney, useLanguage } from '@saas/ui';

interface FakeCheckout {
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  expiresAt: string;
  invoice: {
    number: string;
    status: string;
    tenantName: string;
    pluginName: string;
    periodStart: string | null;
    periodEnd: string | null;
    currency: string;
    total: string;
    dueAt: string;
  };
}

type Outcome = 'PAID' | 'FAILED' | 'EXPIRED';
const METHODS = ['VA', 'QRIS', 'EWALLET', 'CARD'] as const;

/**
 * Test-mode stand-in for a hosted payment page (Xendit later). Reachable without
 * login: whoever has the link can pay, as with a real provider. The buttons make
 * the API send itself the callback a real provider would.
 */
export default function FakePaymentPage() {
  const { t } = useLanguage();
  const { checkoutId } = useParams<{ checkoutId: string }>();
  const [checkout, setCheckout] = useState<FakeCheckout | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading');
  const [method, setMethod] = useState<(typeof METHODS)[number]>('VA');
  const [sending, setSending] = useState<Outcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = t('billing.payPage.documentTitle');
    fetch(`${API_URL}/billing/fake/checkouts/${encodeURIComponent(checkoutId)}`)
      .then(async (res) => {
        if (res.status === 404 || res.status === 400) return setState('not-found');
        if (!res.ok) return setState('error');
        setCheckout(await res.json());
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [checkoutId, t]);

  const simulate = async (outcome: Outcome) => {
    setSending(outcome);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/billing/fake/checkouts/${encodeURIComponent(checkoutId)}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.message || t('common.error'));
        setSending(null);
        return;
      }
      window.location.assign(body.redirectUrl);
    } catch {
      setMessage(t('common.error'));
      setSending(null);
    }
  };

  const closedReason =
    checkout && (checkout.invoice.status === 'PAID'
      ? t('billing.payPage.alreadyPaid')
      : checkout.invoice.status === 'VOID'
        ? t('billing.payPage.closed')
      : checkout.status === 'EXPIRED' || new Date(checkout.expiresAt).getTime() <= Date.now()
        ? t('billing.payPage.expired')
        : checkout.status !== 'PENDING'
          ? t('billing.payPage.closed')
          : null);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-lg">
        <div className="mb-5 flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>{t('billing.payPage.testMode')}</strong> — {t('billing.payPage.testModeNote')}</span>
        </div>

        {state === 'loading' && <div className="flex justify-center py-10"><Spinner /></div>}

        {(state === 'not-found' || state === 'error') && (
          <div className="py-6 text-center">
            <p className="mb-4 text-sm">{state === 'not-found' ? t('billing.payPage.notFound') : t('common.error')}</p>
            <Link href="/billing" className="text-sm underline">{t('billing.payPage.backToBilling')}</Link>
          </div>
        )}

        {state === 'ready' && checkout && (
          <>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{checkout.invoice.tenantName}</span>
              <span>{t('billing.invoice.title', { number: checkout.invoice.number })}</span>
            </div>
            <div className="my-3 text-3xl font-bold">{formatMoney(checkout.invoice.total, checkout.invoice.currency)}</div>
            <div className="text-sm text-muted-foreground">
              {checkout.invoice.pluginName}
              {checkout.invoice.periodStart && checkout.invoice.periodEnd &&
                ` · ${formatDate(checkout.invoice.periodStart)} – ${formatDate(checkout.invoice.periodEnd)}`}
            </div>
            <div className="mb-5 text-sm text-muted-foreground">{t('billing.payPage.due', { date: formatDate(checkout.invoice.dueAt) })}</div>

            {closedReason ? (
              <div className="py-4 text-center">
                <p className="mb-4 text-sm">{closedReason}</p>
                <Link href="/billing" className="text-sm underline">{t('billing.payPage.backToBilling')}</Link>
              </div>
            ) : (
              <>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('billing.payPage.method')}</div>
                <div className="mb-5 flex flex-wrap gap-2">
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-sm transition-colors',
                        method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent',
                      )}
                    >
                      {t(`billing.payPage.methods.${m}`)}
                    </button>
                  ))}
                </div>

                <div className="grid gap-2">
                  <Button className="bg-green-600 text-white hover:bg-green-700" disabled={sending !== null} onClick={() => simulate('PAID')}>
                    {sending === 'PAID' ? <Spinner size="sm" /> : t('billing.payPage.succeed')}
                  </Button>
                  <Button variant="destructive" disabled={sending !== null} onClick={() => simulate('FAILED')}>
                    {sending === 'FAILED' ? <Spinner size="sm" /> : t('billing.payPage.fail')}
                  </Button>
                  <Button variant="outline" disabled={sending !== null} onClick={() => simulate('EXPIRED')}>
                    {sending === 'EXPIRED' ? <Spinner size="sm" /> : t('billing.payPage.expire')}
                  </Button>
                </div>
                {message && <p role="alert" className="mt-3 text-sm text-destructive">{message}</p>}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
