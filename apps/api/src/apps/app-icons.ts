/** Icons an app can have (lucide names). The web maps the same names to components (apps/web/lib/app-icons.ts). */
export const APP_ICONS = ['package', 'warehouse', 'truck', 'shopping-cart', 'store', 'factory', 'briefcase', 'clipboard-list', 'calculator', 'users'] as const;

export type AppIcon = (typeof APP_ICONS)[number];
