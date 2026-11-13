// plugins/sample-plugin/src/web/pages/sample-articles/ReviewMeetingCard.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Copy, ExternalLink, Video, XCircle } from 'lucide-react';
import {
  apiClient, ApiRequestError, Button, Card, CardHeader, CardTitle, CardContent, ConfirmDialog, Input, Protect, useLanguage,
} from '@saas/ui';
import { toast } from 'sonner';

type MeetingStatus = 'ACTIVE' | 'CANCELLED' | 'ORPHANED';

interface ReviewMeeting {
  provider: string;
  joinUrl: string;
  hostUserId: string;
  access: 'TRUSTED' | 'OPEN' | 'RESTRICTED';
  status: MeetingStatus;
}

interface ReviewMeetingState {
  meeting: ReviewMeeting | null;
  host: { name: string; isYou: boolean } | null;
}

/** Why no meeting could be made; each has a line in the dictionary */
type Blocked = 'not-connected' | 'needs-permission' | 'disabled' | 'not-configured';

type CreateResult =
  | { status: 'created' | 'existing'; meeting: ReviewMeeting }
  | { status: Blocked }
  | { status: 'unavailable' | 'failed'; message: string };

type CalendarStatus = 'queued' | 'not-connected' | 'disabled' | 'not-configured';

const GOOGLE_PAGE = '/plugins/integration/google-calendar';
const WRITE = { roles: ['ADMIN'], permissions: ['sample-plugin.article.write'] };

const errorMessage = (error: unknown, fallback: string) => (error instanceof ApiRequestError && error.message ? error.message : fallback);

/** The article's review meeting (Google Meet): create, share, put on the host's calendar, cancel */
export function ReviewMeetingCard({ articleId, onNavigate }: { articleId: string; onNavigate?: (path: string) => void }) {
  const { t } = useLanguage();
  const api = `/plugins/sample-plugin/articles/${articleId}/review-meeting`;
  const [state, setState] = useState<ReviewMeetingState | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [busy, setBusy] = useState<'create' | 'cancel' | 'schedule' | null>(null);
  /** Cancel ends a call in progress for everyone: it waits for a confirmation */
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [start, setStart] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await apiClient.get<ReviewMeetingState>(api));
    } catch (error) {
      toast.error(errorMessage(error, t('samplePlugin.articles.reviewMeeting.loadError')));
    }
  }, [api, t]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy('create');
    setBlocked(null);
    try {
      const result = await apiClient.post<CreateResult>(api, {});
      if (result.status === 'created' || result.status === 'existing') {
        toast.success(t('samplePlugin.articles.reviewMeeting.created'));
        await load();
      } else if (result.status === 'unavailable' || result.status === 'failed') {
        toast.error(result.message);
      } else {
        setBlocked(result.status);
      }
    } catch (error) {
      toast.error(errorMessage(error, t('samplePlugin.articles.reviewMeeting.createError')));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      const result = await apiClient.delete<{ status: string; locked: boolean }>(api);
      if (result.locked) toast.success(t('samplePlugin.articles.reviewMeeting.cancelled'));
      else toast.warning(t('samplePlugin.articles.reviewMeeting.cancelledNotLocked'));
      await load();
    } catch (error) {
      toast.error(errorMessage(error, t('samplePlugin.articles.reviewMeeting.cancelError')));
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  };

  const schedule = async () => {
    if (!start) {
      toast.error(t('samplePlugin.articles.reviewMeeting.scheduleNeedsTime'));
      return;
    }
    setBusy('schedule');
    try {
      const { status } = await apiClient.post<{ status: CalendarStatus }>(`${api}/schedule`, { start: new Date(start).toISOString() });
      if (status === 'queued') toast.success(t('samplePlugin.articles.reviewMeeting.scheduled'));
      else toast.warning(t(`samplePlugin.articles.reviewMeeting.calendar.${status}`));
    } catch (error) {
      toast.error(errorMessage(error, t('samplePlugin.articles.reviewMeeting.scheduleError')));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('samplePlugin.articles.reviewMeeting.copied'));
    } catch {
      toast.error(t('samplePlugin.articles.reviewMeeting.copyError'));
    }
  };

  if (!state) return null;
  const { meeting, host } = state;
  const active = meeting?.status === 'ACTIVE' ? meeting : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-4 w-4 text-primary" /> {t('samplePlugin.articles.reviewMeeting.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {active ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={active.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                {active.joinUrl.replace('https://', '')} <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(active.joinUrl)}>
                <Copy className="h-3.5 w-3.5" /> {t('samplePlugin.articles.reviewMeeting.copy')}
              </Button>
            </div>
            {host && (
              <p className="text-muted-foreground">
                {host.isYou ? t('samplePlugin.articles.reviewMeeting.hostedByYou') : t('samplePlugin.articles.reviewMeeting.hostedBy', { name: host.name })}
              </p>
            )}
            <Protect {...WRITE}>
              {host?.isYou && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1">
                    <span className="block text-xs text-muted-foreground">{t('samplePlugin.articles.reviewMeeting.scheduleLabel')}</span>
                    <Input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="w-56" />
                  </label>
                  <Button variant="outline" className="gap-1.5" isLoading={busy === 'schedule'} onClick={schedule}>
                    <CalendarPlus className="h-4 w-4" /> {t('samplePlugin.articles.reviewMeeting.schedule')}
                  </Button>
                </div>
              )}
              <Button variant="outline" className="gap-1.5" isLoading={busy === 'cancel'} onClick={() => setConfirmCancel(true)}>
                <XCircle className="h-4 w-4" /> {t('samplePlugin.articles.reviewMeeting.cancel')}
              </Button>
            </Protect>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              {meeting ? t('samplePlugin.articles.reviewMeeting.unavailable') : t('samplePlugin.articles.reviewMeeting.help')}
            </p>
            <Protect {...WRITE}>
              <Button className="gap-1.5" isLoading={busy === 'create'} onClick={create}>
                <Video className="h-4 w-4" />
                {meeting ? t('samplePlugin.articles.reviewMeeting.createNew') : t('samplePlugin.articles.reviewMeeting.create')}
              </Button>
            </Protect>
            {blocked && (
              <p className="rounded-md border border-warning/30 bg-warning/10 p-3">
                {t(`samplePlugin.articles.reviewMeeting.blocked.${blocked}`)}{' '}
                {(blocked === 'not-connected' || blocked === 'needs-permission') && (
                  <a
                    href={GOOGLE_PAGE}
                    onClick={(event) => {
                      if (!onNavigate) return;
                      event.preventDefault();
                      onNavigate(GOOGLE_PAGE);
                    }}
                    className="font-medium text-primary hover:underline"
                  >
                    {t('samplePlugin.articles.reviewMeeting.openGoogle')}
                  </a>
                )}
              </p>
            )}
          </>
        )}
      </CardContent>

      <ConfirmDialog
        isOpen={confirmCancel}
        onClose={() => busy !== 'cancel' && setConfirmCancel(false)}
        onConfirm={cancel}
        title={t('samplePlugin.articles.reviewMeeting.cancelConfirmTitle')}
        description={t('samplePlugin.articles.reviewMeeting.cancelConfirmMessage')}
        confirmText={t('samplePlugin.articles.reviewMeeting.cancel')}
        cancelText={t('samplePlugin.articles.reviewMeeting.keep')}
        variant="destructive"
        loading={busy === 'cancel'}
      />
    </Card>
  );
}
