// plugins/sample-plugin/src/web/menus.ts
//
// Menu names are i18n keys, not display strings. The sidebar passes each
// `name` through `useLanguage().t(...)` at render time. If a key is missing
// from the dictionaries the renderer prints the path verbatim (safe fallback).
// Keep the keys in sync with `samplePlugin.menu.*` in `src/dictionaries.ts`.
import { Box, Settings, FileText } from 'lucide-react';

export const SamplePluginMenus = [
  {
    name: 'samplePlugin.menu.parent',
    icon: Box,
    permissions: ['sample-plugin.item.read'],
    children: [
      {
        name: 'samplePlugin.menu.items',
        href: '/plugins/sample-plugin/items',
        icon: Box,
        permissions: ['sample-plugin.item.read'],
      },
      {
        name: 'samplePlugin.menu.articles',
        href: '/plugins/sample-plugin/articles',
        icon: FileText,
        permissions: ['sample-plugin.article.read'],
      },
      {
        name: 'samplePlugin.menu.settings',
        href: '/plugins/sample-plugin/settings',
        icon: Settings,
      },
    ],
  },
];
