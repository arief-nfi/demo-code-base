import {
  LayoutDashboard,
  LayoutGrid,
  Users,
  Settings,
  Box,
  Package,
  UserCog,
  BadgeCheck,
  Shield,
  CreditCard,
  Layers,
  GitBranch,
  Mail,
  FileUp,
  Receipt,
  type LucideIcon,
} from 'lucide-react';

export type NavigationItem = {
  name: string;
  href?: string;
  icon: LucideIcon;
  children?: NavigationItem[];
  pluginKey?: string;
  roles?: string[];
  permissions?: string[];
};

export type NavGroup = {
  label: string;
  items: NavigationItem[];
};

export const navigation: NavGroup[] = [
  {
    label: 'Main',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Modules',
    items: [],
  },
  {
    label: 'System',
    items: [
      { name: 'Tenants', href: '/tenants', icon: Users, roles: ['SYSADMIN'] },
      { name: 'Job Queue', href: '/jobs', icon: Layers, roles: ['SYSADMIN'] },
      { name: 'Platform Email Log', href: '/email-log', icon: Mail, roles: ['SYSADMIN'] },
      {
        name: 'Plugins',
        icon: Box,
        roles: ['SYSADMIN', 'ADMIN'],
        children: [
          { name: 'Installed Plugins', href: '/plugins/installed', icon: Package, roles: ['SYSADMIN'] },
          { name: 'Apps', href: '/plugins/apps', icon: LayoutGrid, roles: ['SYSADMIN'] },
          { name: 'Billing', href: '/plugins/subscriptions', icon: CreditCard, roles: ['SYSADMIN'] },
          { name: 'Tenant Plugins', href: '/plugins/tenant', icon: Package, roles: ['ADMIN'] },
        ],
      },
      {
        name: 'Systems',
        icon: Settings,
        roles: ['ADMIN'],
        permissions: ['system.permission.read', 'system.role.read', 'system.user.read'],
        children: [
          { name: 'Permissions', href: '/systems/permissions', icon: BadgeCheck, roles: ['ADMIN'], permissions: ['system.permission.read'] },
          { name: 'Roles', href: '/systems/roles', icon: Shield, roles: ['ADMIN'], permissions: ['system.role.read'] },
          { name: 'Users', href: '/systems/users', icon: UserCog, roles: ['ADMIN'], permissions: ['system.user.read'] },
          { name: 'Billing', href: '/billing', icon: Receipt, roles: ['ADMIN'] },
          { name: 'Workflow Templates', href: '/systems/workflow-templates', icon: GitBranch, roles: ['SYSADMIN'] },
          { name: 'Workflows', href: '/systems/workflows', icon: GitBranch, roles: ['ADMIN'], permissions: ['system.workflow.manage'] },
          { name: 'Data Import', href: '/systems/imports', icon: FileUp, roles: ['ADMIN'] },
          { name: 'Email', href: '/systems/email', icon: Mail, roles: ['ADMIN'], permissions: ['system.email.read'] },
          { name: 'Preferences', href: '/systems/preferences', icon: Settings, roles: ['ADMIN'] },
        ],
      },
    ],
  },
];

/** Route-to-label mapping for breadcrumbs and page titles */
export const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/tenants': 'Tenants',
  '/tenants/create': 'Create Tenant',
  '/systems': 'Systems',
  '/systems/users': 'Users',
  '/systems/roles': 'Roles',
  '/systems/permissions': 'Permissions',
  '/systems/workflow-templates': 'Workflow Templates',
  '/systems/workflows': 'Workflows',
  '/systems/imports': 'Data Import',
  '/systems/preferences': 'Preferences',
  '/systems/email': 'Email',
  '/email-log': 'Platform Email Log',
  '/plugins': 'Plugins',
  '/plugins/installed': 'Installed Plugins',
  '/plugins/apps': 'Apps',
  '/plugins/tenant': 'Tenant Plugins',
  '/plugins/subscriptions': 'Billing',
  '/billing': 'Billing',
  '/billing/invoices': 'Invoices',
  '/account/profile': 'Profile',
};

/** Flatten all navigation items for search/command palette */
export function flattenNavigation(groups: NavGroup[]): NavigationItem[] {
  const result: NavigationItem[] = [];
  const flatten = (items: NavigationItem[]) => {
    for (const item of items) {
      if (item.href) result.push(item);
      if (item.children) flatten(item.children);
    }
  };
  for (const group of groups) {
    flatten(group.items);
  }
  return result;
}
