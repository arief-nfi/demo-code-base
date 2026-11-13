'use client';

import { forbidden } from 'next/navigation';
import { ListPageSkeleton, PageContainer, useLanguage, useRBAC } from '@saas/ui';
import { PageHeader } from '@/components/page-header';
import { EmailLog } from '@/components/email/email-log';

/** The sysadmin's log of platform emails (welcome, lifecycle, billing, contact sales). */
export default function PlatformEmailLogPage() {
  const { hasRole, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  if (isRBACLoading) return <PageContainer><ListPageSkeleton /></PageContainer>;
  if (!hasRole('SYSADMIN')) forbidden();

  return (
    <PageContainer>
      <PageHeader title={t('email.platformTitle')} description={t('email.platformDescription')} />
      <EmailLog basePath="/email/platform/messages" canRetry showTenant />
    </PageContainer>
  );
}
