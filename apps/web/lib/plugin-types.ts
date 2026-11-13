import type React from 'react';

/**
 * Props every plugin page component can receive.
 * Both fields are optional so existing prop-less pages stay compatible.
 *
 * - `params` is populated by the plugin router when the route key contains
 *   `[name]` segments (e.g. route key `/articles/[id]` with request
 *   `/articles/abc-123` → `params = { id: 'abc-123' }`).
 * - `searchParams` is forwarded from Next.js.
 */
export interface PluginPageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
}

export type PluginComponent = React.ComponentType<PluginPageProps>;
