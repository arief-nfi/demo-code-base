'use client';

import { useEffect, useRef } from 'react';
import { apiClient, PageContainer, useLanguage } from '@saas/ui';
import { toast } from 'sonner';
import { GOOGLE_CALENDAR_API, GOOGLE_CALENDAR_PAGE, errorMessage, type ConnectionView } from './types';

export interface GoogleCalendarCallbackPageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  onNavigate?: (path: string) => void;
}

/** Where Google sends the user back after consent: finishes the connect, then returns to the page. */
export const GoogleCalendarCallbackPage = ({ searchParams, onNavigate }: GoogleCalendarCallbackPageProps) => {
  const { t } = useLanguage();
  // The state is single-use: StrictMode's second effect run must not post it again
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const done = () => onNavigate?.(GOOGLE_CALENDAR_PAGE);
    const code = searchParams?.code;
    const state = searchParams?.state;
    if (searchParams?.error || !code || !state) {
      toast.error(t('integration.googleCalendar.googleDenied'));
      done();
      return;
    }

    apiClient
      .post<ConnectionView>(`${GOOGLE_CALENDAR_API}/callback`, { code, state })
      .then((connection) => {
        // Google lets people untick a feature on its consent screen: say which one is missing
        const missing = (['calendar', 'meet'] as const).filter((feature) => connection.features[feature] === 'needs-permission');
        if (missing.length === 0) toast.success(t('integration.googleCalendar.connectSuccess'));
        else toast.warning(t('integration.googleCalendar.connectedWithout', { feature: missing.map((feature) => t(`integration.googleCalendar.features.${feature}`)).join(', ') }));
      })
      .catch((error) => toast.error(errorMessage(error, t('integration.googleCalendar.connectError'))))
      .finally(done);
  }, [searchParams, onNavigate, t]);

  return (
    <PageContainer>
      <div className="flex h-[50vh] items-center justify-center gap-3 text-muted-foreground">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        {t('integration.googleCalendar.connecting')}
      </div>
    </PageContainer>
  );
};
