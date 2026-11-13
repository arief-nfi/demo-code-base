'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarDays, ExternalLink, RefreshCw } from 'lucide-react';
import {
  apiClient, cn, PageContainer, PageHeader, Button, Badge, Card, CardHeader, CardTitle, CardContent, Checkbox,
  DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  useRBAC, useLanguage, Forbidden, formatDateTime,
} from '@saas/ui';
import { toast } from 'sonner';
import { GoogleCalendarAdmin } from './GoogleCalendarAdmin';
import {
  CONNECT_PERMISSION, GOOGLE_CALENDAR_API, MANAGE_PERMISSION, STATUS_VARIANT, errorMessage,
  type ConnectionView, type FeatureState, type GoogleFeature, type GoogleSettings, type MyGoogleStatus,
} from './types';

export interface GoogleCalendarPageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  onNavigate?: (path: string) => void;
}

export const GoogleCalendarPage = (_props: GoogleCalendarPageProps) => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();
  const canConnect = authorize({ roles: ['ADMIN'], permissions: [CONNECT_PERMISSION] });
  const canManage = authorize({ roles: ['ADMIN'], permissions: [MANAGE_PERMISSION] });

  const [mine, setMine] = useState<MyGoogleStatus | null>(null);
  const [settings, setSettings] = useState<GoogleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    if (isRBACLoading) return;
    setLoading(true);
    try {
      const [me, tenant] = await Promise.all([
        canConnect ? apiClient.get<MyGoogleStatus>(`${GOOGLE_CALENDAR_API}/me`) : Promise.resolve(null),
        canManage ? apiClient.get<GoogleSettings>(`${GOOGLE_CALENDAR_API}/settings`) : Promise.resolve(null),
      ]);
      setMine(me);
      setSettings(tenant);
    } catch (error) {
      toast.error(errorMessage(error, t('integration.googleCalendar.loadError')));
    } finally {
      setLoading(false);
    }
  }, [isRBACLoading, canConnect, canManage, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (isRBACLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!canConnect && !canManage) return <Forbidden />;

  const configured = mine?.configured ?? settings?.configured;
  // Also reloads the admin cards, whose users list and sync log a (dis)connect changes
  const refresh = () => {
    load();
    setReloadKey((key) => key + 1);
  };

  return (
    <PageContainer>
      <PageHeader title={t('integration.googleCalendar.title')} description={t('integration.googleCalendar.description')}>
        <Button onClick={refresh} variant="outline" className="gap-2" aria-label={t('integration.googleCalendar.refresh')}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </PageHeader>

      {configured === false && (
        <Card>
          <CardContent className="flex items-start gap-3 p-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="font-medium">{t('integration.googleCalendar.notConfigured')}</p>
              <p className="text-sm text-muted-foreground">{t('integration.googleCalendar.notConfiguredHint')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {configured && (
        <div className="space-y-6">
          {canConnect && mine && <MyGoogleCard status={settings ? { ...mine, ...settings } : mine} onChanged={refresh} />}
          {canManage && settings && (
            <GoogleCalendarAdmin
              key={reloadKey}
              settings={settings}
              onSettingsChange={(next) => {
                setSettings(next);
                // The user's own card follows the switches (e.g. Allow Google Meet appears)
                load();
              }}
            />
          )}
        </div>
      )}
    </PageContainer>
  );
};

function MyGoogleCard({ status, onChanged }: { status: MyGoogleStatus; onChanged: () => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const connection = status.connection?.status === 'DISCONNECTED' ? null : status.connection;

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await apiClient.post<{ url: string }>(`${GOOGLE_CALENDAR_API}/connect`);
      window.location.assign(url);
    } catch (error) {
      toast.error(errorMessage(error, t('integration.googleCalendar.connectError')));
      setBusy(false);
    }
  };

  const anyEnabled = status.calendar.enabled || status.meet.enabled;
  const connectButton = (label: string) =>
    anyEnabled ? (
      <Button onClick={connect} isLoading={busy} className="gap-2">
        <CalendarDays className="h-4 w-4" /> {label}
      </Button>
    ) : (
      <p className="text-sm text-muted-foreground">{t('integration.googleCalendar.switchedOff')}</p>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integration.googleCalendar.myCalendar')}</CardTitle>
        <Badge variant={connection ? STATUS_VARIANT[connection.status] : 'outline'}>
          {connection ? t(`integration.googleCalendar.statuses.${connection.status}`) : t('integration.googleCalendar.notConnected')}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {!connection && (
          <>
            <p className="text-sm text-muted-foreground">{t('integration.googleCalendar.notConnectedHelp')}</p>
            {connectButton(t('integration.googleCalendar.connect'))}
          </>
        )}

        {connection && <ConnectionDetails connection={connection} />}
        {connection && <FeatureLines connection={connection} allowButton={connectButton} />}

        {connection?.status === 'NEEDS_RECONNECT' && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
            <p className="font-medium">{t('integration.googleCalendar.needsReconnect')}</p>
            {connection.lastError && <p className="text-muted-foreground">{connection.lastError}</p>}
          </div>
        )}

        {connection && (
          <div className="flex flex-wrap items-center gap-3">
            {connection.status === 'NEEDS_RECONNECT' && connectButton(t('integration.googleCalendar.reconnect'))}
            <Button variant="outline" onClick={() => setDisconnectOpen(true)}>
              {t('integration.googleCalendar.disconnect')}
            </Button>
            <a
              href="https://myaccount.google.com/connections"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t('integration.googleCalendar.manageAccess')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </CardContent>

      {connection && (
        <DisconnectDialog
          open={disconnectOpen}
          connection={connection}
          onClose={() => setDisconnectOpen(false)}
          onDone={() => {
            setDisconnectOpen(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

/** One line per feature the organization has on: ready, or a button to allow it in Google */
function FeatureLines({ connection, allowButton }: { connection: ConnectionView; allowButton: (label: string) => ReactNode }) {
  const { t } = useLanguage();
  const features = (['calendar', 'meet'] as const).filter((feature) => connection.features[feature] !== 'off');
  if (features.length === 0) return null;
  const label: Record<GoogleFeature, string> = { calendar: t('integration.googleCalendar.features.calendar'), meet: t('integration.googleCalendar.features.meet') };
  const allow: Record<GoogleFeature, string> = { calendar: t('integration.googleCalendar.features.allowCalendar'), meet: t('integration.googleCalendar.features.allowMeet') };
  const state = (feature: GoogleFeature): FeatureState => connection.features[feature];

  return (
    <ul className="space-y-2 text-sm">
      {features.map((feature) => (
        <li key={feature} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <span className="font-medium">{label[feature]}</span>
          {state(feature) === 'ready' ? (
            <Badge variant="success">{t('integration.googleCalendar.features.ready')}</Badge>
          ) : state(feature) === 'needs-permission' ? (
            allowButton(allow[feature])
          ) : (
            <Badge variant="outline">{t('integration.googleCalendar.features.notConnected')}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

function ConnectionDetails({ connection }: { connection: ConnectionView }) {
  const { t } = useLanguage();
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">{t('integration.googleCalendar.googleAccount')}</dt>
        <dd className="font-medium break-all">{connection.accountEmail}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('integration.googleCalendar.calendarLabel')}</dt>
        <dd className="font-medium">{connection.calendarName ?? '—'}</dd>
      </div>
      {(connection.features.calendar === 'ready' || connection.features.calendar === 'not-connected') && (
        <div>
          <dt className="text-muted-foreground">{t('integration.googleCalendar.syncedEvents')}</dt>
          <dd className="font-medium">{connection.syncedEvents}</dd>
        </div>
      )}
      <div className="sm:col-span-3 text-xs text-muted-foreground">
        {t('integration.googleCalendar.connectedAt')}: {formatDateTime(connection.connectedAt)}
      </div>
    </dl>
  );
}

function DisconnectDialog({ open, connection, onClose, onDone }: { open: boolean; connection: ConnectionView; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const [deleteCalendar, setDeleteCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  // A calendar can only be deleted while the connection works
  const canDeleteCalendar = connection.status === 'CONNECTED' && !!connection.calendarName;

  const disconnect = async () => {
    setBusy(true);
    try {
      await apiClient.post(`${GOOGLE_CALENDAR_API}/disconnect`, { deleteCalendar: canDeleteCalendar && deleteCalendar });
      toast.success(t('integration.googleCalendar.disconnectSuccess'));
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, t('integration.googleCalendar.disconnectError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent size="md">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{t('integration.googleCalendar.disconnectTitle')}</DialogTitle>
          <DialogDescription>
            {t('integration.googleCalendar.disconnectMessage')}
            {connection.calendarName && <> {t('integration.googleCalendar.disconnectCalendar')}</>}
            {connection.activeMeetings > 0 && <> {t('integration.googleCalendar.disconnectMeetings')}</>}
          </DialogDescription>
        </DialogHeader>
        {canDeleteCalendar && (
          <label className="flex items-start gap-2 px-6 py-2 text-sm">
            <Checkbox checked={deleteCalendar} onChange={(event) => setDeleteCalendar(event.target.checked)} />
            <span>{t('integration.googleCalendar.deleteCalendar', { name: connection.calendarName ?? '' })}</span>
          </label>
        )}
        <DialogFooter className="p-6 pt-4">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('integration.googleCalendar.cancel')}
          </Button>
          <Button variant="destructive" onClick={disconnect} isLoading={busy}>
            {t('integration.googleCalendar.disconnect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
