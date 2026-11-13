'use client';

import { useEffect, useState } from 'react';
import { EyeOff, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, ApiRequestError, Badge, Button, Dialog, formatDateTime, useLanguage } from '@saas/ui';
import { EmailStatusBadge, type EmailStatus } from './email-log';

interface EmailMessage {
  id: string;
  templateKey: string;
  to: string[];
  from: string;
  replyTo: string | null;
  subject: string;
  html: string;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  note: string | null;
  redacted: boolean;
  isTest: boolean;
  /** `platform`: sent by the platform (read-only in a workspace log) */
  origin?: 'tenant' | 'platform';
  createdAt: string;
  sentAt: string | null;
}

interface EmailMessageDialogProps {
  basePath: string;
  id: string | null;
  canRetry: boolean;
  onClose: () => void;
  onRetried: () => void;
}

export function EmailMessageDialog({ basePath, id, canRetry, onClose, onRetried }: EmailMessageDialogProps) {
  const { t } = useLanguage();
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMessage(null);
    if (!id) return;
    apiClient.get<EmailMessage>(`${basePath}/${id}`).then(setMessage).catch(() => toast.error(t('email.loadError')));
  }, [basePath, id, t]);

  // In a workspace log, an email the platform sent is read-only: only the platform resends it
  const fromPlatform = basePath === '/email/messages' && message?.origin === 'platform';

  const retry = async () => {
    if (!message) return;
    setBusy(true);
    try {
      await apiClient.post(`${basePath}/${message.id}/retry`);
      toast.success(t('email.retried'));
      onRetried();
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : t('email.retryError'));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );

  return (
    <Dialog isOpen={!!id} onClose={onClose} title={t('email.detailTitle')} size="lg" showFooter={false}>
      {!message ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            {field(t('email.colSubject'), <span className="font-medium">{message.subject}</span>)}
            {field(t('email.from'), message.from)}
            {field(t('email.to'), message.to.join(', '))}
            {message.replyTo && field(t('email.replyToLabel'), message.replyTo)}
            {field(t('email.colTemplate'), <code className="text-xs">{message.templateKey}</code>)}
            {field(t('email.colStatus'), (
              <span className="flex flex-wrap items-center gap-2">
                <EmailStatusBadge status={message.status} />
                {message.isTest && <Badge variant="outline">{t('email.test')}</Badge>}
                {message.redacted && <Badge variant="outline"><EyeOff className="mr-1 h-3 w-3" />{t('email.hidden')}</Badge>}
              </span>
            ))}
            {field(t('email.createdAt'), formatDateTime(message.createdAt))}
            {message.sentAt && field(t('email.sentAt'), formatDateTime(message.sentAt))}
            {field(t('email.attempts'), message.attempts)}
            {message.lastError && field(t('email.error'), <span className="text-destructive">{message.lastError}</span>)}
            {message.note && field(t('email.note'), message.note)}
          </div>

          {message.redacted && <p className="text-xs text-muted-foreground">{t('email.hiddenHelp')}</p>}
          {fromPlatform && <p className="text-xs text-muted-foreground">{t('email.sentByPlatform')}</p>}

          {/* sandbox="" : no scripts, no forms, its own origin */}
          <iframe title={message.subject} sandbox="" srcDoc={message.html} className="h-[420px] w-full rounded-md border border-border bg-white" />

          {canRetry && !fromPlatform && message.status === 'FAILED' && (
            message.redacted ? (
              <p className="text-sm text-muted-foreground">{t('email.noRetryRedacted')}</p>
            ) : (
              <div className="flex justify-end">
                <Button size="sm" className="gap-1.5" disabled={busy} onClick={retry}>
                  <RotateCw className="h-3.5 w-3.5" /> {t('email.retry')}
                </Button>
              </div>
            )
          )}
        </div>
      )}
    </Dialog>
  );
}
