'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, RotateCcw, Save, Send } from 'lucide-react';
import {
  apiClient, ApiRequestError, cn, PageContainer, Button, Input, Label, Badge, ConfirmDialog, Protect,
  Card, CardContent, useRBAC, useLanguage, Forbidden,
} from '@saas/ui';
import { toast } from 'sonner';
import { TemplateCodeEditor } from '../components/template-code-editor';
import { EmailVariablesPanel, type EmailVariable } from '../components/email-variables-panel';

type Locale = 'en' | 'id';
interface Content { subject: string; html: string }
interface Edit extends Content { version: number; updatedAt: string; problems: string[] }

interface EmailDetail {
  key: string;
  name: string;
  description: string;
  variables: EmailVariable[];
  sensitive: string[];
  defaults: Record<Locale, Content>;
  edits: Record<Locale, Edit | null>;
}

interface Rendered { subject: string; html: string; text: string }

export interface EmailTemplateEditorPageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  onNavigate?: (path: string) => void;
}

const LOCALES: Locale[] = ['en', 'id'];
const UPDATE = ['document-templates.email-template.update'];

/** The problems the API returns for a template it refuses (errors.template) */
const problemsOf = (error: unknown): string[] => (error instanceof ApiRequestError ? error.errors?.template ?? [] : []);

export const EmailTemplateEditorPage = ({ onNavigate, searchParams }: EmailTemplateEditorPageProps) => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();
  const key = searchParams?.key ?? '';
  // A platform email (sysadmins only): stored for the whole platform, sent to every workspace
  const platform = searchParams?.scope === 'platform';
  const endpoint = `/plugins/document-templates/${platform ? 'platform-emails' : 'emails'}/${encodeURIComponent(key)}`;

  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocale] = useState<Locale>('en');
  const [drafts, setDrafts] = useState<Record<Locale, Content>>({ en: { subject: '', html: '' }, id: { subject: '', html: '' } });
  const [problems, setProblems] = useState<string[]>([]);
  const [preview, setPreview] = useState<Rendered | null>(null);
  const [previewError, setPreviewError] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'reset' | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  /** Loads the email; with `only`, refreshes just that language's draft and keeps the other's unsaved work */
  const load = useCallback(async (only?: Locale) => {
    try {
      const data = await apiClient.get<EmailDetail>(endpoint);
      setDetail(data);
      const fresh = (l: Locale) => data.edits[l] ?? data.defaults[l];
      setDrafts((prev) => (only ? { ...prev, [only]: fresh(only) } : { en: fresh('en'), id: fresh('id') }));
    } catch (error) {
      console.error('Failed to load email', error);
      toast.error(t('documentTemplates.emails.loadError') || 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  }, [endpoint, t]);

  useEffect(() => {
    load();
  }, [load]);

  const draft = drafts[locale];

  // Live preview, rendered by the API with sample data in the tenant layout
  useEffect(() => {
    if (!detail) return;
    const timer = setTimeout(async () => {
      try {
        setPreview(await apiClient.post<Rendered>(`${endpoint}/${locale}/preview`, draft));
        setPreviewError(null);
      } catch (error) {
        setPreviewError(problemsOf(error));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [detail, endpoint, locale, draft]);

  const setDraft = (patch: Partial<Content>) => {
    setDrafts((prev) => ({ ...prev, [locale]: { ...prev[locale], ...patch } }));
    setProblems([]);
  };

  const insert = (expression: string) => {
    const textarea = editorRef.current?.querySelector<HTMLTextAreaElement>('textarea');
    const insertAtCursor = (textarea as unknown as { __insertAtCursor?: (text: string) => void })?.__insertAtCursor;
    if (insertAtCursor) insertAtCursor(expression);
    else setDraft({ html: draft.html + expression });
  };

  const save = async () => {
    setBusy('save');
    try {
      await apiClient.put(`${endpoint}/${locale}`, draft);
      toast.success(t('documentTemplates.emails.saved') || 'Email saved');
      await load(locale);
    } catch (error) {
      const found = problemsOf(error);
      setProblems(found);
      if (found.length === 0) toast.error(t('documentTemplates.emails.saveError') || 'Failed to save the email');
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy('test');
    try {
      const result = await apiClient.post<{ status: string }>(`${endpoint}/${locale}/test`, draft);
      if (result.status === 'SKIPPED') toast.warning(t('documentTemplates.emails.testSkipped') || 'Email sending is not configured');
      else toast.success(t('documentTemplates.emails.testSent') || 'Test email sent to your address');
    } catch (error) {
      const found = problemsOf(error);
      setProblems(found);
      if (found.length === 0) toast.error(t('documentTemplates.emails.testError') || 'Failed to send the test email');
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy('reset');
    try {
      await apiClient.delete(`${endpoint}/${locale}`);
      toast.success(t('documentTemplates.emails.resetDone') || 'Email reset to the default');
      setResetOpen(false);
      setProblems([]);
      await load(locale);
    } catch (error) {
      console.error('Failed to reset email', error);
      toast.error(t('documentTemplates.emails.resetError') || 'Failed to reset the email');
    } finally {
      setBusy(null);
    }
  };

  if (isRBACLoading || loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['document-templates.email-template.read'] }) || !detail) {
    return <Forbidden />;
  }

  const edit = detail.edits[locale];

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('documentTemplates.emails.back') || 'Back to emails'}
            onClick={() => onNavigate?.('/plugins/document-templates/emails')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{detail.name}</h1>
              {platform && <Badge variant="outline">{t('documentTemplates.emails.platformBadge') || 'Platform email'}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{detail.description}</p>
          </div>
        </div>
        <Protect roles={['ADMIN']} permissions={UPDATE}>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!edit || busy !== null} onClick={() => setResetOpen(true)}>
              <RotateCcw className="h-3.5 w-3.5" /> {t('documentTemplates.emails.reset') || 'Reset to default'}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={sendTest}>
              <Send className="h-3.5 w-3.5" /> {t('documentTemplates.emails.sendTest') || 'Send test to me'}
            </Button>
            <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={save}>
              <Save className="h-3.5 w-3.5" />
              {busy === 'save' ? t('documentTemplates.emails.saving') || 'Saving...' : t('documentTemplates.emails.save') || 'Save'}
            </Button>
          </div>
        </Protect>
      </div>

      <div className="mb-4 flex items-center gap-2">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => { setLocale(l); setProblems([]); }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              l === locale ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`documentTemplates.emails.languages.${l}`) || l}
          </button>
        ))}
        <Badge variant={edit ? 'success' : 'outline'}>
          {edit ? t('documentTemplates.emails.stateCustomized') || 'Customized' : t('documentTemplates.emails.usingDefault') || 'Using the default'}
        </Badge>
      </div>

      {edit && edit.problems.length > 0 && (
        <div className="mb-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {t('documentTemplates.emails.storedProblems') || 'Your saved version is not being used:'}</div>
          <ul className="mt-1 list-disc pl-6">{edit.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      {problems.length > 0 && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="font-medium">{t('documentTemplates.emails.problems') || "This email can't be saved yet:"}</div>
          <ul className="mt-1 list-disc pl-6">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_220px]">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('documentTemplates.emails.subject') || 'Subject'}</Label>
              <Input value={draft.subject} onChange={(e) => setDraft({ subject: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-1.5" ref={editorRef}>
              <Label className="text-xs">{t('documentTemplates.emails.body') || 'Body (HTML)'}</Label>
              {/* Keyed by language: the editor keeps its own text between renders */}
              <TemplateCodeEditor key={locale} value={draft.html} onChange={(html) => setDraft({ html })} height="420px" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <Label className="text-xs">{t('documentTemplates.emails.preview') || 'Preview'}</Label>
            {previewError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {t('documentTemplates.emails.previewError') || 'The preview could not be rendered'}
                {previewError.length > 0 && <ul className="mt-1 list-disc pl-6">{previewError.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
            ) : (
              <>
                <div className="rounded-md bg-muted px-3 py-2 text-sm font-medium">{preview?.subject}</div>
                {/* sandbox="" : no scripts, no forms, its own origin */}
                <iframe title={t('documentTemplates.emails.preview') || 'Preview'} sandbox="" srcDoc={preview?.html ?? ''} className="h-[460px] w-full rounded-md border border-border bg-white" />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-2">
            <EmailVariablesPanel variables={detail.variables} sensitive={detail.sensitive} onInsert={insert} />
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        isOpen={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={reset}
        title={t('documentTemplates.emails.resetTitle') || 'Reset to the default?'}
        description={t('documentTemplates.emails.resetDescription') || 'Your changes for this language will be deleted.'}
        confirmText={t('documentTemplates.emails.reset') || 'Reset to default'}
        variant="destructive"
        loading={busy === 'reset'}
      />
    </PageContainer>
  );
};
