'use client';

import Link from 'next/link';
import { ArrowLeft, Building } from 'lucide-react';
import { useAuthStore, Button } from '@saas/ui';
import { ThemeToggle } from '../theme-toggle';
import { NotificationBell } from '../notification-bell';
import { TenantThemeProvider } from '../tenant-theme-provider';
import { DynamicFavicon } from '../dynamic-favicon';
import { API_URL } from '@saas/ui';

export function FullscreenLayout({ children }: { children: React.ReactNode }) {
  const tenantName = useAuthStore((s) => s.tenantName);
  const tenantLogo = useAuthStore((s) => s.tenantLogo);

  return (
    <div className="flex h-screen flex-col bg-background">
      <TenantThemeProvider />
      <DynamicFavicon />

      {/* Minimal header */}
      <header className="flex h-12 items-center justify-between border-b border-border px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <ArrowLeft className="h-4 w-4" /> Dashboard
            </Button>
          </Link>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            {tenantLogo ? (
              <img src={`${API_URL}${tenantLogo}`} alt="" className="h-6 w-6 rounded object-cover" />
            ) : (
              <Building className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">{tenantName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <ThemeToggle />
        </div>
      </header>

      {/* Full content area */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
