'use client';

import { TenantThemeProvider } from '../tenant-theme-provider';

export function EmbeddedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-auto bg-background">
      <TenantThemeProvider />

      {/* No chrome — pure content for iframe embedding */}
      <main className="h-full w-full">
        {children}
      </main>
    </div>
  );
}
