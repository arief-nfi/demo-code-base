'use client';

import { useTheme } from 'next-themes';
import { useTenantTheme } from '@saas/ui';

export function TenantThemeProvider() {
  const { resolvedTheme } = useTheme();
  useTenantTheme(resolvedTheme);
  return null;
}
