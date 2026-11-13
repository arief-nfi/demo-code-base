import { Briefcase, Calculator, ClipboardList, Factory, Package, ShoppingCart, Store, Truck, Users, Warehouse, type LucideIcon } from 'lucide-react';

/** Icons an app can have — the same names the API accepts (apps/api/src/apps/app-icons.ts). */
export const APP_ICON_COMPONENTS = {
  package: Package,
  warehouse: Warehouse,
  truck: Truck,
  'shopping-cart': ShoppingCart,
  store: Store,
  factory: Factory,
  briefcase: Briefcase,
  'clipboard-list': ClipboardList,
  calculator: Calculator,
  users: Users,
} satisfies Record<string, LucideIcon>;

export type AppIcon = keyof typeof APP_ICON_COMPONENTS;

export const APP_ICONS = Object.keys(APP_ICON_COMPONENTS) as AppIcon[];

/** The component for an app's icon; unknown names fall back to a package. */
export function appIcon(name: string | null | undefined): LucideIcon {
  return (name && (APP_ICON_COMPONENTS as Record<string, LucideIcon>)[name]) || Package;
}
