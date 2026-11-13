'use client';

import { Fragment, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle, Building, Check, ChevronRight, CloudOff, Copy, LogOut, RotateCw, ServerCrash, WifiOff,
  type LucideIcon,
} from 'lucide-react';
import {
  API_URL, Button, cn, describeLoadError, signOut, useAuthStore, useAutoRetry, useLanguage,
  type AuthGateErrorState, type LoadErrorKind,
} from '@saas/ui';

const ICONS: Record<LoadErrorKind, LucideIcon> = {
  offline: WifiOff,
  unreachable: CloudOff,
  unavailable: ServerCrash,
  failed: AlertTriangle,
};

interface SessionErrorScreenProps extends AuthGateErrorState {
  retry: () => void;
}

/**
 * What SessionGate shows when the signed-in session can't be loaded. Says in
 * plain words what went wrong, retries on its own when the failure can clear
 * up (offline, API restarting or down), and keeps sign-out within reach for
 * when retrying can't help. The workspace and account come from the persisted
 * auth store, so they show even when the API is unreachable.
 */
export function SessionErrorScreen({ error, retrying, failures, retry }: SessionErrorScreenProps) {
  const { t, locale } = useLanguage();
  const pathname = usePathname();
  const { kind, delay, secondsLeft } = useAutoRetry({ error, retrying, failures, retry });
  const tenantName = useAuthStore((s) => s.tenantName);
  const tenantSlug = useAuthStore((s) => s.tenantSlug);
  const tenantLogo = useAuthStore((s) => s.tenantLogo);
  const username = useAuthStore((s) => s.username);
  const [logoFailed, setLogoFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new time for each new failure
  const failedAt = useMemo(() => new Date(), [error]);

  const Icon = ICONS[kind];
  const transient = kind !== 'failed';
  const account = username && tenantSlug ? `${username}@${tenantSlug}` : null;
  const details = [
    { label: t('sessionError.errorLabel'), value: describeLoadError(error) },
    { label: t('sessionError.pageLabel'), value: pathname },
    {
      label: t('sessionError.timeLabel'),
      value: failedAt.toLocaleString(locale === 'id' ? 'id-ID' : 'en-US', { dateStyle: 'medium', timeStyle: 'medium' }),
      copy: failedAt.toISOString(),
    },
    ...(account ? [{ label: t('sessionError.accountLabel'), value: account }] : []),
  ];

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(details.map((d) => `${d.label}: ${d.copy ?? d.value}`).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the details stay readable on screen.
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-[440px]">
        {tenantName && (
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary text-primary-foreground shadow-xs">
              {tenantLogo && !logoFailed ? (
                <img
                  src={`${API_URL}${tenantLogo}`}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <Building className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight text-foreground">{tenantName}</p>
              {tenantSlug && <p className="truncate text-xs text-muted-foreground">{tenantSlug}</p>}
            </div>
          </div>
        )}

        <section
          role="alert"
          aria-labelledby="session-error-title"
          className="relative overflow-hidden rounded-xl border bg-card shadow-sm"
        >
          {transient && secondsLeft !== null && delay !== null && (
            // The wait until the next automatic try, emptying as it runs down.
            <div className="absolute inset-x-0 top-0 h-0.5 bg-warning/15 motion-reduce:hidden" aria-hidden="true">
              <div
                key={failures}
                className="h-full origin-left bg-warning"
                style={{ animation: `drain ${delay}s linear forwards` }}
              />
            </div>
          )}

          <div className="p-6 sm:p-8">
            <div
              className={cn(
                'mb-5 flex h-10 w-10 items-center justify-center rounded-lg',
                transient ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 id="session-error-title" className="text-xl font-semibold tracking-tight text-foreground">
              {t(`sessionError.${kind}Title`)}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(`sessionError.${kind}Body`)}</p>

            {transient && (
              <p className="mt-5 flex items-center gap-2 text-sm text-foreground">
                {retrying ? (
                  <RotateCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
                ) : (
                  <span className="relative flex h-2 w-2" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-60 motion-reduce:animate-none" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
                  </span>
                )}
                <span className="tabular-nums">
                  {retrying || secondsLeft === null
                    ? t('sessionError.retrying')
                    : t('sessionError.retryingIn', { seconds: secondsLeft })}
                </span>
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button onClick={retry} disabled={retrying} isLoading={retrying && !transient} className="gap-2">
                {!(retrying && !transient) && <RotateCw className="h-4 w-4" aria-hidden="true" />}
                {transient ? t('sessionError.tryAgainNow') : t('sessionError.tryAgain')}
              </Button>
              <Button variant="outline" onClick={() => signOut()} className="gap-2">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {t('sessionError.signOut')}
              </Button>
            </div>
          </div>

          <details className="group border-t">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-6 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:px-8 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="h-4 w-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                aria-hidden="true"
              />
              {t('sessionError.details')}
            </summary>
            <div className="px-6 pb-5 sm:px-8">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {details.map((d) => (
                  <Fragment key={d.label}>
                    <dt className="text-muted-foreground">{d.label}</dt>
                    <dd className="min-w-0 break-words text-foreground">{d.value}</dd>
                  </Fragment>
                ))}
              </dl>
              <Button variant="outline" size="sm" onClick={copyDetails} className="mt-4 gap-1.5">
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? t('sessionError.copied') : t('sessionError.copy')}
              </Button>
            </div>
          </details>
        </section>

        <p className="mt-6 text-xs leading-5 text-muted-foreground">
          {account && `${t('sessionError.signedInAs', { account })} `}
          {t('sessionError.help')}
        </p>
      </div>
    </main>
  );
}
