import { AdminLayout } from '@/components/admin-layout';
import { SessionGate } from '@/components/session-gate';
import { TenantThemeProvider } from '@/components/tenant-theme-provider';
import { DynamicFavicon } from '@/components/dynamic-favicon';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Outside the gate so the loading screen already uses the tenant's colors. */}
      <TenantThemeProvider />
      <DynamicFavicon />
      <SessionGate>
        <AdminLayout>{children}</AdminLayout>
      </SessionGate>
    </>
  );
}
