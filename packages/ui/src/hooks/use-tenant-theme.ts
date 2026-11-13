'use client';

import { useLayoutEffect } from 'react';
import { useAuthStore } from '../stores/auth-store';

/**
 * Convert a hex color string (#RRGGBB) to HSL values.
 * Returns { h, s, l } where h is 0-360, s and l are 0-100.
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = hex.match(/^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/);
  if (!match) return null;

  const r = parseInt(match[1], 16) / 255;
  const g = parseInt(match[2], 16) / 255;
  const b = parseInt(match[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslString(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

/**
 * Derive a lighter or darker variant by adjusting lightness.
 */
function adjustLightness(hsl: { h: number; s: number; l: number }, delta: number): { h: number; s: number; l: number } {
  return { h: hsl.h, s: hsl.s, l: Math.max(0, Math.min(100, hsl.l + delta)) };
}

/**
 * Compute a readable foreground color (white or dark) for a given background lightness.
 */
function foregroundForBg(bgLightness: number): string {
  return bgLightness > 55 ? 'hsl(224 71% 4%)' : 'hsl(0 0% 100%)';
}

// CSS custom properties we manage
const MANAGED_PROPERTIES = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--accent',
  '--accent-foreground',
  '--sidebar-background',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
  '--sidebar-muted',
  '--sidebar-muted-foreground',
];

function clearManagedProperties() {
  const root = document.documentElement;
  for (const prop of MANAGED_PROPERTIES) {
    root.style.removeProperty(prop);
  }
}

/**
 * Hook that injects tenant-specific color overrides as CSS custom properties.
 * Must be used inside a component wrapped with next-themes ThemeProvider.
 */
export function useTenantTheme(resolvedTheme?: string) {
  const primaryColor = useAuthStore((s) => s.tenantPrimaryColor);
  const accentColor = useAuthStore((s) => s.tenantAccentColor);
  const sidebarBackground = useAuthStore((s) => s.tenantSidebarBackground);
  const sidebarForeground = useAuthStore((s) => s.tenantSidebarForeground);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const isDark = resolvedTheme === 'dark';

    const hasAnyColor = primaryColor || accentColor || sidebarBackground || sidebarForeground;
    if (!hasAnyColor) {
      clearManagedProperties();
      return;
    }

    // Primary color
    if (primaryColor) {
      const hsl = hexToHsl(primaryColor);
      if (hsl) {
        const primary = isDark ? adjustLightness(hsl, 8) : hsl;
        root.style.setProperty('--primary', hslString(primary.h, primary.s, primary.l));
        root.style.setProperty('--primary-foreground', foregroundForBg(primary.l));
        root.style.setProperty('--ring', hslString(primary.h, primary.s, primary.l));
      }
    }

    // Accent color
    if (accentColor) {
      const hsl = hexToHsl(accentColor);
      if (hsl) {
        const accent = isDark ? adjustLightness(hsl, -60) : adjustLightness(hsl, 40);
        root.style.setProperty('--accent', hslString(accent.h, Math.min(accent.s, 20), accent.l));
        root.style.setProperty('--accent-foreground', isDark ? 'hsl(210 40% 98%)' : 'hsl(224 71% 4%)');
      }
    }

    // Sidebar colors
    if (sidebarBackground) {
      const hsl = hexToHsl(sidebarBackground);
      if (hsl) {
        root.style.setProperty('--sidebar-background', hslString(hsl.h, hsl.s, hsl.l));

        // Derive sidebar sub-colors from the background
        const accentBg = adjustLightness(hsl, hsl.l > 50 ? -8 : 6);
        root.style.setProperty('--sidebar-accent', hslString(accentBg.h, accentBg.s, accentBg.l));
        root.style.setProperty('--sidebar-accent-foreground', foregroundForBg(hsl.l));

        const borderColor = adjustLightness(hsl, hsl.l > 50 ? -12 : 10);
        root.style.setProperty('--sidebar-border', hslString(borderColor.h, borderColor.s, borderColor.l));

        root.style.setProperty('--sidebar-muted', hslString(accentBg.h, accentBg.s, accentBg.l));
        const mutedFg = adjustLightness(hsl, hsl.l > 50 ? -35 : 35);
        root.style.setProperty('--sidebar-muted-foreground', hslString(mutedFg.h, Math.min(mutedFg.s, 25), mutedFg.l));

        // Sidebar primary uses the tenant's primary color if set, else derives
        if (primaryColor) {
          const pHsl = hexToHsl(primaryColor);
          if (pHsl) {
            root.style.setProperty('--sidebar-primary', hslString(pHsl.h, pHsl.s, pHsl.l));
            root.style.setProperty('--sidebar-primary-foreground', foregroundForBg(pHsl.l));
            root.style.setProperty('--sidebar-ring', hslString(pHsl.h, pHsl.s, pHsl.l));
          }
        }
      }
    }

    // Sidebar foreground (explicit override)
    if (sidebarForeground) {
      const hsl = hexToHsl(sidebarForeground);
      if (hsl) {
        root.style.setProperty('--sidebar-foreground', hslString(hsl.h, hsl.s, hsl.l));
      }
    }

    return () => {
      clearManagedProperties();
    };
  }, [primaryColor, accentColor, sidebarBackground, sidebarForeground, resolvedTheme]);
}
