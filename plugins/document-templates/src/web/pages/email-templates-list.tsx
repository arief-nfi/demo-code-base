'use client';

import { useCallback, useEffect, useState } from 'react';
import { Edit, Mail, RefreshCw } from 'lucide-react';
import {
  apiClient, cn, PageContainer, PageHeader, Button, Badge, Card, CardContent,
  useRBAC, useLanguage, Forbidden,
} from '@saas/ui';
import { toast } from 'sonner';

type LocaleState = { state: 'default' | 'customized' | 'needs_attention'; problems: string[]; updatedAt?: string };

interface EmailRow {
  key: string;
  /** `core` or the plugin key; absent on platform emails */
  source?: string;
  name: string;
  description: string;
  locales: Record<'en' | 'id', LocaleState>;
}

export interface EmailTemplatesListPageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  onNavigate?: (path: string) => void;
}

const LOCALES = ['en', 'id'] as const;

export const EmailTemplatesListPage = ({ onNavigate }: EmailTemplatesListPageProps) => {
  const { authorize, hasRole, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();
  // A boolean, not hasRole itself: hasRole is a new function each render
  const isSysadmin = hasRole('SYSADMIN');
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [platformRows, setPlatformRows] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const loadError = () => toast.error(t('documentTemplates.emails.loadError') || 'Failed to load emails');
    // The platform list fails on its own: the workspace's emails stay usable
    const platform = isSysadmin
      ? apiClient.get<EmailRow[]>('/plugins/document-templates/platform-emails').then(setPlatformRows, (error) => {
          console.error('Failed to load platform emails', error);
          loadError();
        })
      : Promise.resolve(setPlatformRows([]));
    try {
      setRows(await apiClient.get<EmailRow[]>('/plugins/document-templates/emails'));
    } catch (error) {
      console.error('Failed to load emails', error);
      loadError();
    } finally {
      await platform;
      setLoading(false);
    }
  }, [t, isSysadmin]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  if (isRBACLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['document-templates.email-template.read'] })) {
    return <Forbidden />;
  }

  const stateBadge = (locale: (typeof LOCALES)[number], state: LocaleState) => {
    const label = t(`documentTemplates.emails.languages.${locale}`) || locale;
    if (state.state === 'customized') {
      return <Badge variant="success">{label}: {t('documentTemplates.emails.stateCustomized') || 'Customized'}</Badge>;
    }
    if (state.state === 'needs_attention') {
      return (
        <span title={state.problems.join('\n')}>
          <Badge variant="warning">{label}: {t('documentTemplates.emails.stateNeedsAttention') || 'Needs attention'}</Badge>
        </span>
      );
    }
    return <Badge variant="outline">{label}: {t('documentTemplates.emails.stateDefault') || 'Default'}</Badge>;
  };

  const groups = rows.reduce<Record<string, EmailRow[]>>((acc, row) => {
    (acc[row.source ?? 'core'] ??= []).push(row);
    return acc;
  }, {});

  const openEditor = (key: string, platform = false) =>
    onNavigate?.(`/plugins/document-templates/emails/edit?key=${encodeURIComponent(key)}${platform ? '&scope=platform' : ''}`);

  const renderGroup = (id: string, title: string, items: EmailRow[], platform: boolean, help?: string) => (
    <div key={id}>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      {help && <p className="mb-2 text-sm text-muted-foreground">{help}</p>}
      <Card className="overflow-hidden">
        <CardContent padded={false}>
          <ul className="divide-y divide-border">
            {items.map((row) => (
              <li key={row.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" className="flex items-start gap-3 text-left" onClick={() => openEditor(row.key, platform)}>
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block font-medium hover:text-primary">{row.name}</span>
                    <span className="block text-sm text-muted-foreground">{row.description}</span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {LOCALES.map((locale) => <span key={locale}>{stateBadge(locale, row.locales[locale])}</span>)}
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEditor(row.key, platform)}>
                    <Edit className="h-3.5 w-3.5" /> {t('documentTemplates.emails.edit') || 'Edit'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('documentTemplates.emails.title') || 'Email Templates'}
        description={t('documentTemplates.emails.description') || 'Reword the emails your users receive.'}
      >
        <Button onClick={fetchRows} variant="outline" className="gap-2">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </Button>
      </PageHeader>

      {!loading && rows.length === 0 && platformRows.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t('documentTemplates.emails.empty') || 'No emails to customize yet.'}
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {Object.entries(groups).map(([source, items]) =>
          renderGroup(source, source === 'core' ? t('documentTemplates.emails.sourceCore') || 'Core' : source, items, false),
        )}
        {platformRows.length > 0 &&
          renderGroup(
            'platform',
            t('documentTemplates.emails.platformGroup') || 'Platform emails',
            platformRows,
            true,
            t('documentTemplates.emails.platformGroupHelp') || undefined,
          )}
      </div>
    </PageContainer>
  );
};
