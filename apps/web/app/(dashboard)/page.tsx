'use client';

import {
  PageContainer,
  useLanguage,
  useRBAC,
  useAuthStore,
  usePreferencesStore,
  Button,
  DashboardSkeleton,
  ErrorAlert,
  apiClient,
  Card,
  CardContent,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Badge,
  formatDate,
} from '@saas/ui';
import type { DashboardWidgetConfig } from '@saas/ui';
import { useEffect, useState, useMemo } from 'react';
import {
  Building2, Users, UserCheck, Shield, Plug, KeyRound,
  ArrowRight, Settings, User, Globe, Clock, Calendar,
  DollarSign, Palette, Languages, ArrowUpRight,
} from 'lucide-react';
import Link from 'next/link';
import { getImageUrl } from '@/lib/utils';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';

// Plugin dashboard widgets — empty until plugins export them
const PluginDashboardWidgets: Record<string, DashboardWidgetConfig[]> = {};

interface DashboardData {
  userProfile: {
    id: string; username: string; email: string; name: string;
    avatar: string | null; status: string; roles: Array<{ name: string }>;
  };
  tenantInfo: {
    id: string; name: string; slug: string; status: string; createdAt: string;
    config: {
      description: string | null; domain: string | null; theme: string;
      language: string; currency: string; timezone: string;
      dateFormat: string; timeFormat: string;
      numberFormat?: string; currencyFormat?: string;
    } | null;
  };
  usersStats: { total: number; active: number; inactive: number };
  rolesCount: number;
  permissionsCount: number;
  plugins: Array<{ id: string; name: string; key: string; description: string }>;
}

const StatItem = ({ icon, label, value, href, color }: {
  icon: React.ReactNode; label: string; value: number; href?: string; color: string;
}) => {
  const content = (
    <Card className={`${color} ${href ? 'group hover:shadow-md hover:-translate-y-0.5 transition-all duration-150' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="rounded-lg bg-white/15 p-2">{icon}</div>
          {href && <ArrowUpRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-white/60" />}
        </div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-xs opacity-70 mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
};

export default function Home() {
  const { t } = useLanguage();
  const { hasRole, hasPermission } = useRBAC();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const storedTenantName = useAuthStore(s => s.tenantName);
  const tenantSlug = useAuthStore(s => s.tenantSlug) || '';

  useEffect(() => {
    document.title = `Dashboard | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const d = await apiClient.get<DashboardData>('/dashboard');
      setData(d);
      if (d.tenantInfo?.config) {
        const c = d.tenantInfo.config;
        usePreferencesStore.getState().setPreferences({
          ...(c.dateFormat && { dateFormat: c.dateFormat }),
          ...(c.timeFormat && { timeFormat: c.timeFormat }),
          ...(c.timezone && { timezone: c.timezone }),
          ...(c.currency && { currency: c.currency }),
          ...(c.numberFormat && { numberFormat: c.numberFormat }),
          ...(c.currencyFormat && { currencyFormat: c.currencyFormat }),
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Collect enabled plugin widgets
  const pluginWidgets = useMemo(() => {
    if (!data) return [];
    const enabledKeys = new Set(data.plugins.map(p => p.key));
    const widgets: DashboardWidgetConfig[] = [];
    for (const [key, configs] of Object.entries(PluginDashboardWidgets)) {
      if (enabledKeys.has(key)) {
        widgets.push(...configs);
      }
    }
    return widgets.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }, [data]);

  if (loading) return <PageContainer><DashboardSkeleton /></PageContainer>;
  if (error || !data) return <PageContainer><ErrorAlert message={error || 'Error'} onRetry={fetchData} /></PageContainer>;

  const { userProfile, tenantInfo, usersStats, rolesCount, permissionsCount, plugins } = data;
  const canViewUsers = hasRole('ADMIN') || hasPermission('system.user.read');
  const canViewRoles = hasRole('ADMIN') || hasPermission('system.role.read');
  const canViewPermissions = hasRole('ADMIN') || hasPermission('system.permission.read');
  const canViewPlugins = hasRole('ADMIN') || hasPermission('system.plugin.read');
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  const quickActions = [
    canViewUsers && { href: '/systems/users', icon: <Users className="h-4 w-4" />, label: t('dashboard.manageUsers') },
    canViewRoles && { href: '/systems/roles', icon: <Shield className="h-4 w-4" />, label: t('dashboard.manageRoles') },
    canViewPlugins && { href: '/plugins/tenant', icon: <Plug className="h-4 w-4" />, label: t('dashboard.managePlugins') },
    hasRole('ADMIN') && { href: '/systems/preferences', icon: <Settings className="h-4 w-4" />, label: t('common.settings') },
    { href: '/account/profile', icon: <User className="h-4 w-4" />, label: t('dashboard.viewProfile') },
  ].filter(Boolean) as Array<{ href: string; icon: React.ReactNode; label: string }>;

  const configRows = tenantInfo?.config ? [
    tenantInfo.config.domain && { icon: <Globe className="h-3.5 w-3.5" />, label: t('dashboard.domain'), value: tenantInfo.config.domain, mono: true },
    { icon: <Palette className="h-3.5 w-3.5" />, label: t('dashboard.theme'), value: tenantInfo.config.theme.charAt(0) + tenantInfo.config.theme.slice(1).toLowerCase() },
    { icon: <Languages className="h-3.5 w-3.5" />, label: t('dashboard.language'), value: tenantInfo.config.language === 'ENGLISH' ? 'English' : 'Indonesia' },
    { icon: <DollarSign className="h-3.5 w-3.5" />, label: t('dashboard.currency'), value: tenantInfo.config.currency },
    { icon: <Clock className="h-3.5 w-3.5" />, label: t('dashboard.timezone'), value: tenantInfo.config.timezone },
    { icon: <Calendar className="h-3.5 w-3.5" />, label: t('dashboard.dateFormat'), value: tenantInfo.config.dateFormat, mono: true },
  ].filter(Boolean) as Array<{ icon: React.ReactNode; label: string; value: string; mono?: boolean }> : [];

  return (
    <PageContainer>
      {/* Widget Grid — 4 columns on desktop, 2 on tablet, 1 on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Welcome */}
        <DashboardWidget size="full">
          <div className="mb-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {t('dashboard.welcomeTitle', { username: userProfile?.name || userProfile?.username || '' })}
            </h1>
            <p className="text-muted-foreground mt-1">{t('dashboard.welcomeDescription')}</p>
          </div>
        </DashboardWidget>

        {/* Stats Row */}
        <DashboardWidget size="full">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatItem icon={<Users className="h-4 w-4 text-white" />} label={t('dashboard.totalUsers')} value={usersStats?.total ?? 0} href={canViewUsers ? '/systems/users' : undefined} color="bg-blue-600 text-white" />
            <StatItem icon={<UserCheck className="h-4 w-4 text-white" />} label={t('dashboard.activeUsers')} value={usersStats?.active ?? 0} href={canViewUsers ? '/systems/users' : undefined} color="bg-emerald-600 text-white" />
            <StatItem icon={<Shield className="h-4 w-4 text-white" />} label={t('dashboard.roles')} value={rolesCount ?? 0} href={canViewRoles ? '/systems/roles' : undefined} color="bg-violet-600 text-white" />
            <StatItem icon={<KeyRound className="h-4 w-4 text-white" />} label={t('dashboard.permissions')} value={permissionsCount ?? 0} href={canViewPermissions ? '/systems/permissions' : undefined} color="bg-amber-600 text-white" />
          </div>
        </DashboardWidget>

        {/* Profile Banner */}
        <DashboardWidget size="full">
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <Avatar size="xl">
                  {userProfile?.avatar && <AvatarImage src={getImageUrl(userProfile.avatar)} alt={userProfile.name || userProfile.username} />}
                  <AvatarFallback>{getInitials(userProfile?.name || userProfile?.username || 'U')}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold truncate">{userProfile?.name || userProfile?.username}</h2>
                  <p className="text-sm text-muted-foreground truncate">{userProfile?.email}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {userProfile?.roles.map((role, idx) => <Badge key={idx} variant="outline" className="text-xs">{role.name}</Badge>)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </DashboardWidget>

        {/* Organization */}
        <DashboardWidget size="md" title={tenantInfo?.name || 'Organization'}>
          {tenantInfo?.createdAt && (
            <p className="text-xs text-muted-foreground mb-3">{t('dashboard.memberSince')} {formatDate(tenantInfo.createdAt)}</p>
          )}
          {configRows.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {configRows.map((row, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 py-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">{row.icon}<span>{row.label}</span></div>
                  <span className={`text-sm ${row.mono ? 'font-mono bg-muted px-1.5 py-0.5 rounded text-xs' : ''}`}>{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </DashboardWidget>

        {/* Quick Actions */}
        <DashboardWidget size="sm" title={t('dashboard.quickActions')}>
          <div className="space-y-1">
            {quickActions.map((action, idx) => (
              <Link key={idx} href={action.href}>
                <Button variant="ghost" className="w-full justify-start gap-2.5 h-9 font-normal text-sm">
                  <span className="text-muted-foreground">{action.icon}</span>
                  {action.label}
                </Button>
              </Link>
            ))}
          </div>
        </DashboardWidget>

        {/* Active Plugins */}
        <DashboardWidget size="sm" title={t('dashboard.activatedPlugins')}>
          {plugins.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t('dashboard.noPluginsActivated')}</p>
          ) : (
            <div className="space-y-2">
              {plugins.map((plugin) => (
                <div key={plugin.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30">
                  <Plug className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-sm font-medium truncate">{plugin.name}</p>
                </div>
              ))}
            </div>
          )}
        </DashboardWidget>

        {/* Plugin-contributed widgets */}
        {pluginWidgets.map((widget) => (
          <DashboardWidget key={widget.id} size={widget.size} title={widget.title}>
            <widget.component tenantSlug={tenantSlug} />
          </DashboardWidget>
        ))}

      </div>
    </PageContainer>
  );
}
