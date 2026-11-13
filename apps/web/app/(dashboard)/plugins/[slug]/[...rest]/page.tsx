// apps/web/app/(dashboard)/plugins/[slug]/[...rest]/page.tsx
import { PluginRouteLoaders } from '@/lib/plugin-routes';
import { notFound } from 'next/navigation';
import { PluginGuard } from '@/components/plugin-guard';
import { PluginPageWrapper } from '@/components/plugin-page-wrapper';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

interface PageProps {
  params: Promise<{ slug: string; rest: string[] }>;
  searchParams: Promise<Record<string, string>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, rest } = await params;
  const cookieStore = await cookies();
  const tenantName = cookieStore.get('tenantName')?.value || 'SaaS Admin';
  const pluginName = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  const pageName = rest[rest.length - 1].split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return {
    title: `${pluginName} - ${pageName} | ${tenantName}`,
  };
}

/**
 * Resolve a request path against the plugin's route map.
 * Tries exact match first (fast path, preserves existing behavior),
 * then falls back to template matching for keys containing `[param]` segments.
 */
function resolveRoute(
  routes: Record<string, React.ComponentType<any>>,
  reqSegments: string[],
): { Component: React.ComponentType<any> | undefined; params: Record<string, string> } {
  const path = `/${reqSegments.join('/')}`;

  // Fast path: exact match
  const exact = routes[path];
  if (exact) return { Component: exact, params: {} };

  // Template match: iterate keys looking for `[param]` placeholders
  for (const key of Object.keys(routes)) {
    const clean = key.startsWith('/') ? key.slice(1) : key;
    const keySegments = clean.length === 0 ? [] : clean.split('/');
    if (keySegments.length !== reqSegments.length) continue;

    const matched: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < keySegments.length; i++) {
      const ks = keySegments[i];
      const rs = reqSegments[i];
      if (ks.startsWith('[') && ks.endsWith(']')) {
        if (!rs) { ok = false; break; }
        matched[ks.slice(1, -1)] = rs;
      } else if (ks !== rs) {
        ok = false;
        break;
      }
    }
    if (ok) return { Component: routes[key], params: matched };
  }

  return { Component: undefined, params: {} };
}

export default async function DynamicPluginSubPage({ params, searchParams }: PageProps) {
  const { slug, rest } = await params;
  const resolvedSearchParams = await searchParams;
  const loader = PluginRouteLoaders[slug];

  if (!loader) {
    return notFound();
  }

  // Load only this plugin's pages (not every plugin's) for this request.
  const routes = await loader();

  const { Component: PluginComponent, params: routeParams } = resolveRoute(routes, rest);

  if (!PluginComponent) {
    return notFound();
  }

  return (
    <PluginGuard slug={slug}>
      <PluginPageWrapper
        Component={PluginComponent}
        searchParams={resolvedSearchParams}
        params={routeParams}
      />
    </PluginGuard>
  );
}
