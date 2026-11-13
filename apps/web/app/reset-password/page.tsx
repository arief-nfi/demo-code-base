'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, Eye, EyeOff, Lock, Loader2, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { API_URL, Button, Input, Label } from '@saas/ui';
import { useLanguage } from '@saas/ui';
import { AuthLayout } from '@/components/auth-layout';

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validationError, setValidationError] = useState('');
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const token = searchParams.get('token');
  const tenant = searchParams.get('tenant');

  useEffect(() => {
    document.title = 'Reset Password | SaaS Multitenant';
  }, []);

  useEffect(() => {
    if (!token || !tenant) {
      setError(t('resetPassword.invalidLink'));
    }
  }, [token, tenant, t]);

  const validatePassword = (pwd: string) => {
    if (pwd.length < 8) return 'Password must be at least 8 characters long';
    if (!/[a-z]/.test(pwd)) return 'Password must contain at least one lowercase letter';
    if (!/[A-Z]/.test(pwd)) return 'Password must contain at least one uppercase letter';
    if (!/\d/.test(pwd)) return 'Password must contain at least one number';
    return '';
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    setValidationError(validatePassword(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (password !== confirmPassword) {
      toast.error(t('resetPassword.passwordsNoMatch'));
      return;
    }

    if (!token || !tenant) {
      toast.error(t('resetPassword.invalidLink'));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, tenantSlug: tenant, newPassword: password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to reset password');
      }

      setSuccess(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reset password';
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
            {t('security.passwordUpdated')}
          </div>
        }
      >
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left">
            <div className="mx-auto lg:mx-0 w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-500" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              {t('resetPassword.successTitle')}
            </h2>
            <p className="mt-4 text-muted-foreground">
              {t('resetPassword.successMessage')}
            </p>
          </div>

          <Link href="/login">
            <Button className="w-full">{t('resetPassword.goToLogin')}</Button>
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
            {t('resetPassword.testimonial')}
          </blockquote>
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">{t('resetPassword.strongSecurity')}</div>
              <div className="text-sidebar-muted-foreground text-sm">
                {t('resetPassword.passwordValidation')}
              </div>
            </div>
          </div>
        </div>
      }
    >
      <div className="w-full max-w-md space-y-8">
        <div className="text-center lg:text-left">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">
            {t('resetPassword.title')}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t('resetPassword.description')}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit} aria-label="Reset password form">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t('resetPassword.newPasswordLabel')}</Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="pl-10 pr-10"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? t('common.hidePassword') : t('common.showPassword')}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {password && (
                <div className="space-y-1 text-xs">
                  <div className={password.length >= 8 ? 'text-green-600' : 'text-muted-foreground'}>
                    {password.length >= 8 ? '✓' : '○'} {t('resetPassword.requirement8Chars')}
                  </div>
                  <div className={/[a-z]/.test(password) ? 'text-green-600' : 'text-muted-foreground'}>
                    {/[a-z]/.test(password) ? '✓' : '○'} {t('resetPassword.requirementLowercase')}
                  </div>
                  <div className={/[A-Z]/.test(password) ? 'text-green-600' : 'text-muted-foreground'}>
                    {/[A-Z]/.test(password) ? '✓' : '○'} {t('resetPassword.requirementUppercase')}
                  </div>
                  <div className={/\d/.test(password) ? 'text-green-600' : 'text-muted-foreground'}>
                    {/\d/.test(password) ? '✓' : '○'} {t('resetPassword.requirementNumber')}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('resetPassword.confirmPasswordLabel')}</Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  className="pl-10 pr-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  title={showConfirmPassword ? t('common.hidePassword') : t('common.showPassword')}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-destructive">{t('resetPassword.passwordsNoMatch')}</p>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-4 border border-destructive/20">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !!validationError || password !== confirmPassword}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                {t('resetPassword.resetting')}
              </>
            ) : (
              t('resetPassword.resetButton')
            )}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
