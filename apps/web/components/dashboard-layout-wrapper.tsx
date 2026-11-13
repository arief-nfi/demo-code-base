'use client';

import { AdminLayout } from './admin-layout';
import { TenantThemeProvider } from './tenant-theme-provider';
import { DynamicFavicon } from './dynamic-favicon';
import { PluginLayoutProvider } from './plugin-layout-provider';

export function DashboardLayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <PluginLayoutProvider
      renderDefault={(content) => (
        <AdminLayout>
          <TenantThemeProvider />
          <DynamicFavicon />
          {content}
        </AdminLayout>
      )}
    >
      {children}
    </PluginLayoutProvider>
  );
}
