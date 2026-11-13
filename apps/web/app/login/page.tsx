'use client';

import { Loader2, Lock, User2, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, useRef, Suspense, useEffect } from 'react';
import { toast } from 'sonner';
import { API_URL, Button, Input, Label, safeReturnUrl } from '@saas/ui';
import { useLanguage } from '@saas/ui';
import { useAuthStore, useRBACStore } from '@saas/ui';
import { useTheme } from 'next-themes';
import { AuthLayout } from '@/components/auth-layout';

interface TenantBranding {
  name: string | null;
  logo: string | null;
  icon: string | null;
  primaryColor: string | null;
}

function LoginForm() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const { t, setLocale } = useLanguage();
  const { setTheme } = useTheme();

  const tenantSlug = searchParams.get('tenant');

  useEffect(() => {
    document.title = 'Login | SaaS Multitenant';
    identifierRef.current?.focus();
  }, []);

  // Fetch tenant branding if ?tenant=slug is present
  useEffect(() => {
    if (!tenantSlug) return;
    fetch(`${API_URL}/tenants/branding/${tenantSlug}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setBranding(data);
          // Apply tenant primary color to login page
          if (data.primaryColor) {
            document.documentElement.style.setProperty('--primary', data.primaryColor);
          }
        }
      })
      .catch(() => {});
    return () => {
      document.documentElement.style.removeProperty('--primary');
    };
  }, [tenantSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
        credentials: 'include', // Receive HttpOnly cookie from backend
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Login failed');
      }

      const data = await res.json();

      useAuthStore.getState().setSession({
        tenantId: data.user.tenantId,
        tenantSlug: data.user.tenantSlug,
        tenantName: data.user.tenantName,
        tenantDescription: data.user.tenantDescription,
        tenantLogo: data.user.tenantLogo,
        tenantIcon: data.user.tenantIcon,
        tenantPrimaryColor: data.user.tenantPrimaryColor,
        tenantAccentColor: data.user.tenantAccentColor,
        tenantSidebarBackground: data.user.tenantSidebarBackground,
        tenantSidebarForeground: data.user.tenantSidebarForeground,
        username: data.user.username,
        avatar: data.user.avatar ?? null,
      });
      useRBACStore.getState().setRBAC(data.user.roles || [], data.user.permissions || []);

      if (data.user.tenantTheme) {
        setTheme(data.user.tenantTheme.toLowerCase());
      }
      if (data.user.tenantLanguage) {
        setLocale(data.user.tenantLanguage === 'INDONESIA' ? 'id' : 'en');
      }

      // Only same-origin paths — never follow an attacker-supplied absolute URL.
      // Full page load, not router.push: the client router may still hold a
      // prefetch of this page that the proxy redirected to /login while signed out.
      window.location.assign(safeReturnUrl(searchParams.get('returnUrl')));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="text-center lg:text-left">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">
          {t('common.welcome')}
        </h2>
        <p className="mt-2 text-muted-foreground">
          {t('login.enterCredentials')}
        </p>
      </div>

      <form className="mt-8 space-y-6" onSubmit={handleSubmit} aria-label="Login form">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">{t('login.username')}</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <Input
                ref={identifierRef}
                id="identifier"
                name="identifier"
                type="text"
                required
                className="pl-10"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                aria-describedby="identifier-hint"
              />
            </div>
            <p id="identifier-hint" className="text-xs text-muted-foreground">
              {t('login.usernameFormat')}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('common.password')}</Label>
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {t('login.forgotPassword')}
              </Link>
            </div>
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
                onChange={(e) => setPassword(e.target.value)}
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
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
              {t('login.signingIn')}
            </>
          ) : (
            t('common.signIn')
          )}
        </Button>
      </form>

      <div className="mt-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-background text-muted-foreground">
              {t('login.noAccount')}
            </span>
          </div>
        </div>

        <div className="mt-6 text-center space-y-2">
          <Link
            href="/register"
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Create a free account
          </Link>
          <span className="mx-2 text-muted-foreground">&middot;</span>
          <Link
            href="/contact-sales"
            className="font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('login.contactSales')}
          </Link>
        </div>
      </div>
    </div>
  );
}

function LoginPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const tenantSlug = searchParams.get('tenant');

  useEffect(() => {
    if (!tenantSlug) return;
    fetch(`${API_URL}/tenants/branding/${tenantSlug}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setBranding(data); })
      .catch(() => {});
  }, [tenantSlug]);

  return (
    <AuthLayout
      logo={branding?.logo}
      tenantName={branding?.name}
      brandingContent={
        <div className="space-y-6">
          <blockquote className="text-2xl font-medium leading-relaxed">
            {t('login.testimonial')}
          </blockquote>
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center font-bold text-sm">
              JD
            </div>
            <div>
              <div className="font-semibold">{t('login.testimonialAuthor')}</div>
              <div className="text-sidebar-muted-foreground text-sm">
                {t('login.testimonialRole')}
              </div>
            </div>
          </div>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="flex justify-center">
            <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center min-h-screen">
          <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
