import { PluginRouteLoaders } from '@/lib/plugin-routes';
import { notFound } from 'next/navigation';
import { PluginGuard } from '@/components/plugin-guard';
import { PluginPageWrapper } from '@/components/plugin-page-wrapper';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const cookieStore = await cookies();
  const tenantName = cookieStore.get('tenantName')?.value || 'SaaS Admin';
  const pluginName = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return {
    title: `${pluginName} | ${tenantName}`,
  };
}

export default async function DynamicPluginPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const loader = PluginRouteLoaders[slug];

  if (!loader) {
    return notFound();
  }

  // Load only this plugin's pages (not every plugin's) for this request.
  const routes = await loader();

  // Default to '/' or 'index' route
  const PluginComponent = routes['/'] || routes['index'];

  if (!PluginComponent) {
    return notFound();
  }

  return (
    <PluginGuard slug={slug}>
      <PluginPageWrapper Component={PluginComponent} searchParams={resolvedSearchParams} />
    </PluginGuard>
  );
}
