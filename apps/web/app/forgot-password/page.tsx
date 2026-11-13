'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, Loader2, Mail, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { API_URL, Button, Input, Label } from '@saas/ui';
import { useLanguage } from '@saas/ui';
import { AuthLayout } from '@/components/auth-layout';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  useEffect(() => {
    document.title = 'Forgot Password | SaaS Multitenant';
    emailRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tenantSlug }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to send reset email');
      }

      setSuccess(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send reset email';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthLayout
        brandingContent={
          <div className="text-2xl font-medium leading-relaxed">
            {t('security.emailSent')}
          </div>
        }
      >
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left">
            <div className="mx-auto lg:mx-0 w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-500" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              {t('forgotPassword.successTitle')}
            </h2>
            <p className="mt-4 text-muted-foreground">
              {t('forgotPassword.successMessage', { email })}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('forgotPassword.successHint')}
            </p>
          </div>

          <Link href="/login">
            <Button variant="outline" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('forgotPassword.backToLogin')}
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      brandingContent={
        <div className="space-y-6">
          <blockquote className="text-2xl font-medium leading-relaxed">
            {t('forgotPassword.testimonial')}
          </blockquote>
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">{t('forgotPassword.secureProcess')}</div>
              <div className="text-sidebar-muted-foreground text-sm">
                {t('forgotPassword.protectedBy')}
              </div>
            </div>
          </div>
        </div>
      }
    >
      <div className="w-full max-w-md space-y-8">
        <div className="text-center lg:text-left">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">
            {t('forgotPassword.title')}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t('forgotPassword.description')}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit} aria-label="Forgot password form">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('forgotPassword.emailLabel')}</Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                </div>
                <Input
                  ref={emailRef}
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="pl-10"
                  placeholder={t('forgotPassword.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenantSlug">{t('forgotPassword.tenantLabel')}</Label>
              <Input
                id="tenantSlug"
                name="tenantSlug"
                type="text"
                required
                placeholder={t('forgotPassword.tenantPlaceholder')}
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                aria-describedby="tenant-hint"
              />
              <p id="tenant-hint" className="text-xs text-muted-foreground">
                {t('forgotPassword.tenantHint')}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                  {t('forgotPassword.sending')}
                </>
              ) : (
                t('forgotPassword.sendButton')
              )}
            </Button>

            <Link href="/login">
              <Button variant="outline" className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('forgotPassword.backToLogin')}
              </Button>
            </Link>
          </div>
        </form>
      </div>
    </AuthLayout>
  );
}
