'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import {
  apiClient, Badge, Button, Card, CardHeader, CardTitle, CardContent, Pagination, Select, Switch,
  useLanguage, formatDateTime,
} from '@saas/ui';
import { toast } from 'sonner';
import { GoogleMeetingsCard } from './GoogleMeetingsCard';
import {
  GOOGLE_CALENDAR_API, MEETING_ACCESS, STATUS_VARIANT, errorMessage,
  type CalendarUserRow, type FeatureState, type GoogleSettings, type LinkStatus, type MeetingAccess, type SyncLogPage,
} from './types';

const PAGE_SIZE = 20;

/** The tenant's switches, who is connected, the meetings and what synced: for the `manage` permission. */
export function GoogleCalendarAdmin({ settings, onSettingsChange }: { settings: GoogleSettings; onSettingsChange: (settings: GoogleSettings) => void }) {
  return (
    <>
      <SettingsCard settings={settings} onSettingsChange={onSettingsChange} />
      <UsersCard calendarEnabled={settings.calendar.enabled} meetEnabled={settings.meet.enabled} />
      <GoogleMeetingsCard />
      <SyncLogCard />
    </>
  );
}

type SettingsPatch = { calendarEnabled?: boolean; meetEnabled?: boolean; meetDefaultAccess?: MeetingAccess };

function SettingsCard({ settings, onSettingsChange }: { settings: GoogleSettings; onSettingsChange: (settings: GoogleSettings) => void }) {
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);

  const save = async (patch: SettingsPatch, done: string) => {
    setSaving(true);
    try {
      onSettingsChange(await apiClient.patch<GoogleSettings>(`${GOOGLE_CALENDAR_API}/settings`, patch));
      toast.success(done);
    } catch (error) {
      toast.error(errorMessage(error, t('integration.googleCalendar.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const accessOptions = MEETING_ACCESS.map((value) => ({ value, label: t(`integration.googleMeet.access.${value}.label`) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integration.googleCalendar.settingsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block font-medium">{t('integration.googleCalendar.enabledLabel')}</span>
            <span className="block text-sm text-muted-foreground">{t('integration.googleCalendar.enabledHelp')}</span>
          </span>
          <Switch
            checked={settings.calendar.enabled}
            disabled={saving}
            onCheckedChange={(value) => save({ calendarEnabled: value }, t(value ? 'integration.googleCalendar.enabledOn' : 'integration.googleCalendar.enabledOff'))}
            aria-label={t('integration.googleCalendar.enabledLabel')}
          />
        </label>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block font-medium">{t('integration.googleMeet.enabledLabel')}</span>
            <span className="block text-sm text-muted-foreground">{t('integration.googleMeet.enabledHelp')}</span>
          </span>
          <Switch
            checked={settings.meet.enabled}
            disabled={saving}
            onCheckedChange={(value) => save({ meetEnabled: value }, t(value ? 'integration.googleMeet.enabledOn' : 'integration.googleMeet.enabledOff'))}
            aria-label={t('integration.googleMeet.enabledLabel')}
          />
        </label>
        {settings.meet.enabled && (
          <div className="space-y-2">
            <span className="block font-medium">{t('integration.googleMeet.defaultAccessLabel')}</span>
            <Select
              className="w-full sm:w-72"
              value={settings.meet.defaultAccess}
              options={accessOptions}
              disabled={saving}
              onChange={(value) => save({ meetDefaultAccess: value as MeetingAccess }, t('integration.googleMeet.defaultAccessSaved'))}
            />
            <p className="text-sm text-muted-foreground">{t(`integration.googleMeet.access.${settings.meet.defaultAccess}.help`)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const featureBadge = (state: FeatureState, t: (key: string) => string) =>
  state === 'ready' ? (
    <Badge variant="success">{t('integration.googleCalendar.features.ready')}</Badge>
  ) : state === 'needs-permission' ? (
    <Badge variant="warning">{t('integration.googleCalendar.features.notAllowed')}</Badge>
  ) : state === 'not-connected' ? (
    <Badge variant="outline">{t('integration.googleCalendar.features.notConnected')}</Badge>
  ) : (
    <Badge variant="outline">{t('integration.googleCalendar.features.off')}</Badge>
  );

/** The switches are only reload triggers: they decide what the Calendar and Meet columns say */
function UsersCard({ calendarEnabled, meetEnabled }: { calendarEnabled: boolean; meetEnabled: boolean }) {
  const { t } = useLanguage();
  const [users, setUsers] = useState<CalendarUserRow[] | null>(null);

  useEffect(() => {
    apiClient
      .get<CalendarUserRow[]>(`${GOOGLE_CALENDAR_API}/users`)
      .then(setUsers)
      .catch((error) => toast.error(errorMessage(error, t('integration.googleCalendar.loadError'))));
  }, [t, calendarEnabled, meetEnabled]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integration.googleCalendar.usersTitle')}</CardTitle>
      </CardHeader>
      <CardContent padded={false}>
        {users && users.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('integration.googleCalendar.usersEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.user')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.googleAccount')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.statusLabel')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.features.calendar')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.features.meet')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.connectedAt')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(users ?? []).map((user) => (
                  <tr key={user.userId}>
                    <td className="px-4 py-2">
                      <span className="block font-medium">{user.name ?? '—'}</span>
                      <span className="block text-xs text-muted-foreground">{user.email}</span>
                    </td>
                    <td className="px-4 py-2 break-all">{user.accountEmail}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span title={user.lastError ?? undefined}>
                        <Badge variant={STATUS_VARIANT[user.status]}>{t(`integration.googleCalendar.statuses.${user.status}`)}</Badge>
                      </span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{featureBadge(user.features.calendar, t)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{featureBadge(user.features.meet, t)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(user.connectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SyncLogCard() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<'' | LinkStatus>('');
  const [page, setPage] = useState(1);
  const [log, setLog] = useState<SyncLogPage | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLog(await apiClient.get<SyncLogPage>(`${GOOGLE_CALENDAR_API}/sync-log`, { status: status || undefined, page, limit: PAGE_SIZE }));
    } catch (error) {
      toast.error(errorMessage(error, t('integration.googleCalendar.loadError')));
    }
  }, [status, page, t]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      await apiClient.post(`${GOOGLE_CALENDAR_API}/sync-log/${id}/retry`);
      toast.success(t('integration.googleCalendar.retrySuccess'));
      await load();
    } catch (error) {
      toast.error(errorMessage(error, t('integration.googleCalendar.retryError')));
    } finally {
      setRetrying(null);
    }
  };

  const statusOptions = [
    { value: '', label: t('integration.googleCalendar.filterAll') },
    ...(['PENDING', 'SYNCED', 'FAILED'] as const).map((value) => ({ value, label: t(`integration.googleCalendar.statuses.${value}`) })),
  ];

  return (
    <Card>
      <CardHeader
        toolbar={
          <Select
            className="w-44"
            value={status}
            options={statusOptions}
            onChange={(value) => {
              setStatus(value as '' | LinkStatus);
              setPage(1);
            }}
          />
        }
      >
        <CardTitle>{t('integration.googleCalendar.syncLogTitle')}</CardTitle>
      </CardHeader>
      <CardContent padded={false}>
        {log && log.data.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('integration.googleCalendar.syncLogEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.event')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.user')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.statusLabel')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.attempts')}</th>
                  <th className="px-4 py-2 font-medium">{t('integration.googleCalendar.updatedAt')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(log?.data ?? []).map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-4 py-2">
                      <span className="block font-medium">{row.title ?? '—'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.source} · {row.key}
                        {row.start && ` · ${formatDateTime(row.start)}`}
                      </span>
                      {row.lastError && <span className="mt-1 block text-xs text-destructive">{row.lastError}</span>}
                    </td>
                    <td className="px-4 py-2">{row.user?.name ?? row.user?.email ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[row.status]}>{t(`integration.googleCalendar.statuses.${row.status}`)}</Badge>
                    </td>
                    <td className="px-4 py-2">{row.attempts}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(row.updatedAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {row.status === 'FAILED' && (
                        <Button size="sm" variant="outline" className="gap-1.5" isLoading={retrying === row.id} onClick={() => retry(row.id)}>
                          <RotateCw className="h-3.5 w-3.5" /> {t('integration.googleCalendar.retry')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log && <Pagination className="p-4" currentPage={log.meta.page} totalPages={log.meta.totalPages} onPageChange={setPage} />}
      </CardContent>
    </Card>
  );
}
