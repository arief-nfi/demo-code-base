'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  apiClient, ApiRequestError, Badge, Button, Card, CardContent, Checkbox,
  DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  useLanguage,
} from '@saas/ui';

interface CalendarConnection {
  provider: string;
  status: 'CONNECTED' | 'NEEDS_RECONNECT';
  accountEmail: string;
  calendarName: string | null;
  lastError: string | null;
  manageAccessUrl?: string;
  /** What the account is used for, and whether each is allowed: `key` has our own words, `name` is the provider's */
  features?: Array<{ key: string; name: string; ready: boolean }>;
  /** Open meetings the user hosts: disconnecting locks them */
  activeMeetings?: number;
}

/**
 * The user's own connected account (e.g. Google, for Calendar and Meet), with a way out. Served by core,
 * so it shows even while the plugin that made the connection is switched off or unpaid.
 * Renders nothing when there is no connection.
 */
export function CalendarConnectionCard() {
  const { t } = useLanguage();
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteCalendar, setDeleteCalendar] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setConnection((await apiClient.get<{ connection: CalendarConnection | null }>('/calendar/connection')).connection);
    } catch {
      setConnection(null); // nothing to show; the rest of the page works without it
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!connection) return null;

  const featureLabel = (feature: { key: string; name: string }) => {
    const path = `calendarConnection.features.${feature.key}`;
    const label = t(path);
    return label === path ? feature.name : label;
  };

  // Deleting the calendar needs a working connection
  const canDeleteCalendar = connection.status === 'CONNECTED' && !!connection.calendarName;

  const disconnect = async () => {
    setBusy(true);
    try {
      await apiClient.post('/calendar/connection/disconnect', { deleteCalendar: canDeleteCalendar && deleteCalendar });
      toast.success(t('calendarConnection.disconnected'));
      setDialogOpen(false);
      setConnection(null);
    } catch (error) {
      toast.error(error instanceof ApiRequestError && error.message ? error.message : t('calendarConnection.disconnectError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="h-fit">
      <CardContent className="p-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary/10 p-2">
              <Link2 className="h-4 w-4 text-primary" />
            </div>
            <h2 className="font-semibold">{t('calendarConnection.title')}</h2>
          </div>
          <Badge variant={connection.status === 'CONNECTED' ? 'success' : 'warning'}>
            {connection.status === 'CONNECTED' ? t('calendarConnection.connected') : t('calendarConnection.needsReconnect')}
          </Badge>
        </div>

        <dl className="mb-6 space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{connection.provider} · {t('calendarConnection.account')}</dt>
            <dd className="font-medium break-all">{connection.accountEmail}</dd>
          </div>
          {!!connection.features?.length && (
            <div>
              <dt className="text-muted-foreground">{t('calendarConnection.usedFor')}</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
                {connection.features.map((feature) => (
                  <span key={feature.key} className="inline-flex items-center gap-1">
                    {featureLabel(feature)}
                    {feature.ready ? (
                      <Check className="h-3.5 w-3.5 text-success" aria-label={t('calendarConnection.allowed')} />
                    ) : (
                      // A connection that needs reconnecting allows nothing for now; the badge above says so
                      connection.status === 'CONNECTED' && <span className="font-normal text-muted-foreground">: {t('calendarConnection.notAllowed')}</span>
                    )}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {connection.calendarName && (
            <div>
              <dt className="text-muted-foreground">{t('calendarConnection.calendar')}</dt>
              <dd className="font-medium">{connection.calendarName}</dd>
            </div>
          )}
          {connection.status === 'NEEDS_RECONNECT' && connection.lastError && (
            <p className="rounded-md border border-warning/30 bg-warning/10 p-3">{connection.lastError}</p>
          )}
        </dl>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            {t('calendarConnection.disconnect')}
          </Button>
          {connection.manageAccessUrl && (
            <a
              href={connection.manageAccessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t('calendarConnection.manageAccess')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </CardContent>

      <DialogRoot open={dialogOpen} onOpenChange={(open) => !open && !busy && setDialogOpen(false)}>
        <DialogContent size="md">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>{t('calendarConnection.disconnectTitle')}</DialogTitle>
            <DialogDescription>
              {t('calendarConnection.disconnectMessage')}
              {connection.calendarName && ` ${t('calendarConnection.disconnectCalendar')}`}
              {(connection.activeMeetings ?? 0) > 0 && ` ${t('calendarConnection.disconnectMeetings')}`}
            </DialogDescription>
          </DialogHeader>
          {canDeleteCalendar && (
            <label className="flex items-start gap-2 px-6 py-2 text-sm">
              <Checkbox checked={deleteCalendar} onChange={(event) => setDeleteCalendar(event.target.checked)} />
              <span>{t('calendarConnection.deleteCalendar', { name: connection.calendarName ?? '' })}</span>
            </label>
          )}
          <DialogFooter className="p-6 pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
              {t('calendarConnection.cancel')}
            </Button>
            <Button variant="destructive" onClick={disconnect} isLoading={busy}>
              {t('calendarConnection.disconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </Card>
  );
}
