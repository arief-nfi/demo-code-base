'use client';

import { usePathname } from 'next/navigation';
import { pluginLayoutConfig } from '@/lib/plugin-layout-config';
import { FullscreenLayout } from './layouts/fullscreen-layout';
import { KioskLayout } from './layouts/kiosk-layout';
import { EmbeddedLayout } from './layouts/embedded-layout';

/**
 * Detects if the current route is a plugin page with a custom layout.
 * If so, wraps children in the appropriate layout instead of AdminLayout.
 * Returns null if the default console layout should be used.
 */
export function usePluginLayout(): string | null {
  const pathname = usePathname();

  // Match /plugins/{slug}/... pattern
  const match = pathname.match(/^\/plugins\/([^/]+)/);
  if (!match) return null;

  const slug = match[1];
  const layout = pluginLayoutConfig[slug];

  // Only return non-console layouts
  if (layout && layout !== 'console') {
    return layout;
  }

  return null;
}

interface PluginLayoutProviderProps {
  children: React.ReactNode;
  renderDefault: (children: React.ReactNode) => React.ReactNode;
}

/**
 * Wraps children in the correct layout based on the plugin's declared layout type.
 * If the plugin uses "console" (default) or the route is not a plugin page,
 * falls back to renderDefault (which renders AdminLayout).
 */
export function PluginLayoutProvider({ children, renderDefault }: PluginLayoutProviderProps) {
  const layout = usePluginLayout();

  if (!layout) {
    return <>{renderDefault(children)}</>;
  }

  switch (layout) {
    case 'fullscreen':
      return <FullscreenLayout>{children}</FullscreenLayout>;
    case 'kiosk':
      return <KioskLayout>{children}</KioskLayout>;
    case 'embedded':
      return <EmbeddedLayout>{children}</EmbeddedLayout>;
    default:
      return <>{renderDefault(children)}</>;
  }
}
