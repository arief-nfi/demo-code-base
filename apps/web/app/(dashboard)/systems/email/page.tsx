'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  apiClient, ApiRequestError, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label,
  ListPageSkeleton, PageContainer, Protect, useLanguage, useRBAC,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';
import { EmailLog } from '@/components/email/email-log';

interface EmailSettings {
  senderName: string | null;
  replyTo: string | null;
  defaultSenderName: string;
}

export default function EmailSettingsPage() {
  const { authorize, hasRole, isLoading: isRBACLoading } = useRBAC();
  // Platform emails (billing, welcome…) are in the sysadmin's platform log, not this workspace's
  const isSysadmin = hasRole('SYSADMIN');
  const { t } = useLanguage();
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [senderName, setSenderName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const canRead = !isRBACLoading && authorize({ roles: ['ADMIN'], permissions: ['system.email.read'] });

  useEffect(() => {
    if (!canRead) return;
    apiClient.get<EmailSettings>('/email/settings').then((data) => {
      setSettings(data);
      setSenderName(data.senderName ?? '');
      setReplyTo(data.replyTo ?? '');
    }).catch(() => toast.error(t('email.loadError')));
  }, [canRead, t]);

  if (isRBACLoading) return <PageContainer><ListPageSkeleton /></PageContainer>;
  if (!canRead) forbidden();

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const saved = await apiClient.patch<EmailSettings>('/email/settings', { senderName, replyTo });
      setSettings(saved);
      toast.success(t('email.saved'));
    } catch (error) {
      if (error instanceof ApiRequestError && error.errors) setErrors(error.errors);
      else toast.error(t('email.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader title={t('email.title')} description={t('email.description')} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('email.sender')}</CardTitle>
            <CardDescription>{t('email.senderDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="senderName">{t('email.senderName')}</Label>
                <Input
                  id="senderName"
                  value={senderName}
                  maxLength={100}
                  placeholder={t('email.senderNamePlaceholder', { name: settings?.defaultSenderName ?? '' })}
                  onChange={(e) => setSenderName(e.target.value)}
                />
                {errors.senderName && <p className="text-xs text-destructive">{errors.senderName.join(' ')}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="replyTo">{t('email.replyTo')}</Label>
                <Input
                  id="replyTo"
                  type="email"
                  value={replyTo}
                  placeholder={t('email.replyToPlaceholder')}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
                {errors.replyTo && <p className="text-xs text-destructive">{errors.replyTo.join(' ')}</p>}
              </div>
            </div>
            <Protect roles={['ADMIN']} permissions={['system.email.write']}>
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving || !settings} className="gap-1.5">
                  <Save className="h-4 w-4" /> {t('email.save')}
                </Button>
              </div>
            </Protect>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <EmailLog basePath="/email/messages" canRetry={authorize({ roles: ['ADMIN'], permissions: ['system.email.write'] })} />
          {isSysadmin && (
            <p className="text-sm text-muted-foreground">
              {t('email.platformPointer')}{' '}
              <Link href="/email-log" className="font-medium text-primary hover:underline">{t('email.platformPointerLink')}</Link>.
            </p>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
