'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { apiClient, ListPageSkeleton, PageContainer } from '@saas/ui';

/** GET /tenant-plugins/enabled — plugins enabled system-wide AND for the tenant (any authenticated user). */
interface EnabledPlugin {
  key: string;
}

export function PluginGuard({ slug, children }: { slug: string; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'enabled' | 'disabled'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const plugins = await apiClient.get<EnabledPlugin[]>('/tenant-plugins/enabled');
        if (cancelled) return;
        setState(plugins.some((p) => p.key === slug) ? 'enabled' : 'disabled');
      } catch {
        if (cancelled) return;
        // If fetch fails (e.g. after refresh also fails), let apiClient handle redirect
        setState('disabled');
      }
    }

    check();
    return () => { cancelled = true; };
  }, [slug]);

  if (state === 'loading') {
    return <PageContainer><ListPageSkeleton /></PageContainer>;
  }

  if (state === 'disabled') {
    notFound();
  }

  return <>{children}</>;
}
