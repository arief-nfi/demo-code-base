'use client';

import { useEffect } from 'react';
import { useAuthStore, API_URL } from '@saas/ui';

export function DynamicFavicon() {
  const tenantIcon = useAuthStore((s) => s.tenantIcon);

  useEffect(() => {
    const href = tenantIcon ? `${API_URL}${tenantIcon}` : '/favicon.ico';

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = href;

    // Also update shortcut icon
    const shortcut = document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
    if (shortcut) {
      shortcut.href = href;
    }
  }, [tenantIcon]);

  return null;
}
