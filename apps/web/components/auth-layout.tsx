'use client';

import type { ReactNode } from 'react';
import { LayoutDashboard, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useLanguage, API_URL } from '@saas/ui';
import { LanguageSwitcher } from '@/components/language-switcher';

interface AuthLayoutProps {
  children: ReactNode;
  /** Content shown in the left branding panel center area */
  brandingContent?: ReactNode;
  /** Tenant logo URL (from public branding endpoint) */
  logo?: string | null;
  /** Tenant name (from public branding endpoint) */
  tenantName?: string | null;
}

export function AuthLayout({ children, brandingContent, logo, tenantName }: AuthLayoutProps) {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen w-full flex">
      {/* Left Side — Branding Panel (theme-aware) */}
      <div className="hidden lg:flex w-1/2 bg-sidebar text-sidebar-foreground p-12 flex-col justify-between relative overflow-hidden">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent" />

        {/* Decorative orbs */}
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-lg font-bold">
            {logo ? (
              <img src={`${API_URL}${logo}`} alt={tenantName || 'Logo'} className="h-8 w-auto object-contain" />
            ) : (
              <LayoutDashboard className="h-6 w-6" />
            )}
            <span>{tenantName || 'SaaS Admin'}</span>
          </div>
        </div>

        {/* Center content (testimonial/message) */}
        <div className="relative z-10 max-w-lg">
          {brandingContent}
        </div>

        {/* Footer badges */}
        <div className="relative z-10 flex gap-6 text-sm text-sidebar-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span>{t('security.enterpriseSecurity')}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{t('security.uptime')}</span>
          </div>
        </div>
      </div>

      {/* Right Side — Form Panel */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background relative">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </div>
  );
}
