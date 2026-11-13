'use client';

import { useSearchParams } from 'next/navigation';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@saas/ui';
import { Suspense } from 'react';

function SuspendedContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status') || 'Tenant suspended';
  const reason = searchParams.get('reason');
  const terminationDate = searchParams.get('terminationDate');

  const isSuspended = status.includes('suspended');
  const isTerminated = status.includes('terminated');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/30 p-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-8 w-8 text-destructive" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">
          {isTerminated ? 'Account Terminated' : 'Account Suspended'}
        </h1>

        <p className="text-muted-foreground mb-6">
          {isTerminated
            ? 'Your account has been scheduled for termination.'
            : 'Your account has been temporarily suspended.'}
        </p>

        {reason && reason !== 'unknown' && (
          <div className="bg-muted/50 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm font-medium text-muted-foreground">Reason</p>
            <p className="text-sm text-foreground mt-1">
              {reason === 'trial_expired'
                ? 'Your free trial has expired. Please contact your administrator to continue.'
                : reason}
            </p>
          </div>
        )}

        {terminationDate && (
          <div className="bg-destructive/5 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm font-medium text-destructive">Data deletion date</p>
            <p className="text-sm text-foreground mt-1">
              {new Date(terminationDate).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Please contact your administrator to export your data before this date.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <Link href="/login">
            <Button variant="outline" className="w-full gap-2">
              <ArrowLeft className="h-4 w-4" /> Back to Login
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function TenantSuspendedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
      <SuspendedContent />
    </Suspense>
  );
}
