'use client';

import { useEffect, useState } from 'react';
import { Building, Plus, Search, X } from 'lucide-react';
import { forbidden } from 'next/dist/client/components/navigation';
import Link from 'next/link';
import {
  Button, Input, ListPageSkeleton, ErrorAlert, EmptyState, Badge,
  PageContainer, useRBAC, useAuthStore, apiClient, formatDate,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'INACTIVE' | 'TRIAL' | 'SUSPENDED' | 'PENDING' | 'TERMINATED';
  trialEndsAt?: string | null;
  terminationDate?: string | null;
  createdAt: string;
}

const statusBadgeVariant: Record<string, 'success' | 'warning' | 'destructive' | 'outline' | 'default'> = {
  ACTIVE: 'success',
  TRIAL: 'default',
  SUSPENDED: 'warning',
  TERMINATED: 'destructive',
  INACTIVE: 'outline',
  PENDING: 'outline',
};

export default function TenantsPage() {
  const { hasRole, isLoading: isRBACLoading } = useRBAC();
  const storedTenantName = useAuthStore(s => s.tenantName);

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    document.title = `Tenants | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  const fetchTenants = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get<Tenant[]>('/tenants');
      setTenants(data);
    } catch (err) {
      console.warn('Failed to fetch tenants', err);
      setError('Failed to fetch tenants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRBACLoading) {
      fetchTenants();
    }
  }, [isRBACLoading]);

  if (isRBACLoading || loading) {
    return <PageContainer><ListPageSkeleton rows={3} cols={3} /></PageContainer>;
  }

  if (!hasRole('SYSADMIN')) {
    forbidden();
  }

  if (error) {
    return <PageContainer><ErrorAlert message={error} onRetry={fetchTenants} /></PageContainer>;
  }

  const filteredTenants = search
    ? tenants.filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.slug.toLowerCase().includes(search.toLowerCase()),
      )
    : tenants;

  return (
    <PageContainer>
      <PageHeader
        title="Tenants"
        description="Manage your SaaS tenants. Each tenant has its own isolated database schema."
      >
        <Link href="/tenants/create">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create Tenant
          </Button>
        </Link>
      </PageHeader>

      {/* Search */}
      {tenants.length > 0 && (
        <div className="mb-6">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search tenants..."
              className="pl-9 pr-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSearch('')}
                className="absolute right-1 top-1 h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredTenants.map((tenant) => (
          <div
            key={tenant.id}
            className="rounded-lg bg-card p-6 text-card-foreground border border-border shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/50"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Building className="h-6 w-6 text-primary" />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusBadgeVariant[tenant.status] || 'outline'}>
                  {tenant.status}
                </Badge>
                {tenant.status === 'TRIAL' && tenant.trialEndsAt && (
                  <span className="text-xs text-muted-foreground">
                    Trial ends {formatDate(tenant.trialEndsAt)}
                  </span>
                )}
                {tenant.status === 'TERMINATED' && tenant.terminationDate && (
                  <span className="text-xs text-destructive">
                    Deletion {formatDate(tenant.terminationDate)}
                  </span>
                )}
                <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                  {tenant.slug}
                </span>
              </div>
            </div>
            <h3 className="text-lg font-medium text-foreground">{tenant.name}</h3>
            <p className="text-sm text-muted-foreground mt-1">ID: {tenant.id}</p>
            <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
              <span className="text-xs text-muted-foreground">
                Created: {formatDate(tenant.createdAt)}
              </span>
              <Link href={`/tenants/${tenant.id}`}>
                <Button variant="link" className="px-0 h-auto">
                  Manage
                </Button>
              </Link>
            </div>
          </div>
        ))}

        {filteredTenants.length === 0 && tenants.length > 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={<Search className="h-8 w-8" />}
              title="No tenants found"
              description="No tenants match your search."
            />
          </div>
        )}

        {tenants.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={<Building className="h-8 w-8" />}
              title="No tenants found"
              description="Get started by creating your first tenant."
              action={
                <Link href="/tenants/create">
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Tenant
                  </Button>
                </Link>
              }
            />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
