'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import {
  Building,
  ChevronDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn, API_URL, apiClient, ScrollArea, Tooltip, TooltipProvider, useAuthStore, usePreferencesStore, useLanguage, signOut } from '@saas/ui';
import { useRBAC } from '@saas/ui';
import { PluginMenus } from '@/lib/plugin-menus';
import { navigation as navConfig, type NavigationItem, type NavGroup } from '@/config/navigation';
import { useNavigationStore } from '@/stores/navigation-store';

/* ------------------------------------------------------------------ */
/*  Utility: get parent names that should be auto-expanded             */
/* ------------------------------------------------------------------ */

function getActiveParents(items: NavigationItem[], pathname: string): string[] {
  const parents: string[] = [];
  const traverse = (item: NavigationItem): boolean => {
    if (item.href === pathname) return true;
    if (item.children?.some(traverse)) {
      parents.push(item.name);
      return true;
    }
    return false;
  };
  items.forEach(traverse);
  return parents;
}

function flattenGroupItems(groups: NavGroup[]): NavigationItem[] {
  return groups.flatMap((g) => g.items);
}

/* ------------------------------------------------------------------ */
/*  Collapsed-mode flyout popover (portal)                             */
/* ------------------------------------------------------------------ */

function SidebarPopover({
  children,
  rect,
  onMouseEnter,
  onMouseLeave,
  className,
}: {
  children: React.ReactNode;
  rect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  className?: string;
}) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'fixed z-50 rounded-md border border-sidebar-border bg-sidebar shadow-lg animate-in fade-in zoom-in-95 duration-200',
        className || 'min-w-[180px]',
      )}
      style={{ left: rect.right + 10, top: rect.top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>,
    document.body,
  );
}

function PopoverContent({ items, pathname }: { items: NavigationItem[]; pathname: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        if (item.children && item.children.length > 0) {
          return (
            <div key={item.name} className="my-1">
              <div className="flex items-center px-2 py-1.5 text-sm font-medium text-sidebar-foreground">
                {item.icon && <item.icon className="mr-2 h-4 w-4 opacity-70" />}
                {t(item.name)}
              </div>
              <div className="ml-4 pl-2 border-l border-sidebar-border/50 flex flex-col gap-0.5">
                <PopoverContent items={item.children} pathname={pathname} />
              </div>
            </div>
          );
        }
        if (!item.href) return null;
        return (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              'flex items-center rounded-md px-2 py-1.5 text-sm transition-colors',
              item.href === pathname
                ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm'
                : 'text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            {item.icon && (
              <item.icon className={cn('mr-2 h-4 w-4', item.href === pathname ? 'opacity-100' : 'opacity-70')} />
            )}
            <span>{t(item.name)}</span>
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SidebarItem — recursive nav item                                   */
/* ------------------------------------------------------------------ */

function SidebarItem({
  item,
  depth = 0,
  expandedItems,
  toggleExpand,
  pathname,
  isCollapsed,
}: {
  item: NavigationItem;
  depth?: number;
  expandedItems: string[];
  toggleExpand: (name: string) => void;
  pathname: string;
  isCollapsed?: boolean;
}) {
  const { t } = useLanguage();
  const [isHovered, setIsHovered] = useState(false);
  const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (!isCollapsed) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (itemRef.current) setPopoverRect(itemRef.current.getBoundingClientRect());
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (!isCollapsed) return;
    hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 100);
  };

  const isExpanded = expandedItems.includes(item.name);
  const hasChildren = item.children && item.children.length > 0;

  const isChildActive = (nav: NavigationItem): boolean => {
    if (nav.href === pathname) return true;
    return nav.children?.some(isChildActive) ?? false;
  };
  const isActive = item.href === pathname || (hasChildren && isChildActive(item));

  if (isCollapsed && depth > 0) return null;

  // Leaf item (no children)
  if (!hasChildren) {
    const link = (
      <Link
        href={item.href!}
        className={cn(
          'group relative flex items-center rounded-md py-2 text-sm transition-colors duration-150',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
            : 'text-sidebar-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
          isCollapsed ? 'justify-center px-2' : '',
        )}
        style={{
          paddingLeft: isCollapsed ? '0.5rem' : `${depth * 1.5 + 0.75}rem`,
          paddingRight: '0.5rem',
        }}
      >
        {isActive && !isCollapsed && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-sidebar-primary" />
        )}
        <item.icon
          className={cn(
            'h-5 w-5 flex-shrink-0',
            !isCollapsed && 'mr-3',
            isActive ? 'text-sidebar-primary' : 'text-sidebar-muted-foreground group-hover:text-sidebar-accent-foreground',
          )}
          aria-hidden="true"
        />
        {!isCollapsed && t(item.name)}
      </Link>
    );

    return (
      <>
        <div ref={itemRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          {isCollapsed ? (
            <Tooltip content={t(item.name)} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          )}
        </div>
        {isCollapsed && isHovered && popoverRect && (
          <SidebarPopover
            rect={popoverRect}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className="w-auto min-w-fit"
          >
            <Link
              href={item.href!}
              className="block px-3 py-2 text-sm font-medium text-sidebar-foreground whitespace-nowrap hover:text-sidebar-primary transition-colors"
            >
              {t(item.name)}
            </Link>
          </SidebarPopover>
        )}
      </>
    );
  }

  // Group item (has children)
  const trigger = (
    <button
      onClick={() => !isCollapsed && toggleExpand(item.name)}
      className={cn(
        'group relative flex w-full items-center justify-between rounded-md py-2 text-sm transition-colors duration-150',
        isActive
          ? 'text-sidebar-accent-foreground'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
        isCollapsed ? 'justify-center px-2' : '',
      )}
      style={{
        paddingLeft: isCollapsed ? '0.5rem' : `${depth * 1.5 + 0.75}rem`,
        paddingRight: '0.5rem',
      }}
      aria-expanded={isExpanded}
    >
      <div className={cn('flex items-center', isCollapsed && 'justify-center w-full')}>
        <item.icon
          className={cn(
            'h-5 w-5 flex-shrink-0',
            !isCollapsed && 'mr-3',
            isActive ? 'text-sidebar-primary' : 'text-sidebar-muted-foreground group-hover:text-sidebar-accent-foreground',
          )}
          aria-hidden="true"
        />
        {!isCollapsed && t(item.name)}
      </div>
      {!isCollapsed && (
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            isExpanded ? 'rotate-0' : '-rotate-90',
          )}
        />
      )}
    </button>
  );

  return (
    <div className="space-y-0.5">
      <div ref={itemRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        {isCollapsed ? (
          <Tooltip content={t(item.name)} side="right">
            {trigger}
          </Tooltip>
        ) : (
          trigger
        )}
      </div>

      {isCollapsed && isHovered && popoverRect && (
        <SidebarPopover
          rect={popoverRect}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="p-1">
            <div className="px-2 py-1.5 text-sm font-semibold text-sidebar-foreground border-b border-sidebar-border mb-1">
              {t(item.name)}
            </div>
            <PopoverContent items={item.children!} pathname={pathname} />
          </div>
        </SidebarPopover>
      )}

      {!isCollapsed && isExpanded && (
        <div className="space-y-0.5">
          {item.children!.map((child) => (
            <SidebarItem
              key={child.name}
              item={child}
              depth={depth + 1}
              expandedItems={expandedItems}
              toggleExpand={toggleExpand}
              pathname={pathname}
              isCollapsed={isCollapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar Props                                                      */
/* ------------------------------------------------------------------ */

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  isCollapsed?: boolean;
  setIsCollapsed?: (isCollapsed: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Sidebar (exported)                                                 */
/* ------------------------------------------------------------------ */

export function Sidebar({ isOpen, setIsOpen, isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const { authorize, isLoading: isRBACLoading } = useRBAC();

  const tenantName = useAuthStore(s => s.tenantName);
  const tenantDescription = useAuthStore(s => s.tenantDescription);
  const tenantLogo = useAuthStore(s => s.tenantLogo);
  const tenantSlug = useAuthStore(s => s.tenantSlug);

  const navGroups = useNavigationStore(s => s.navGroups);
  const setNavGroups = useNavigationStore(s => s.setNavGroups);
  const storedExpandedItems = usePreferencesStore(s => s.sidebarExpandedItems);

  // Initialize store with static nav config
  useEffect(() => {
    if (navGroups.length === 0) setNavGroups(navConfig);
  }, []);

  // Merge persisted expanded items with active route parents
  const [expandedItems, setExpandedItems] = useState<string[]>(() => {
    const activeParents = pathname ? getActiveParents(flattenGroupItems(navConfig), pathname) : [];
    return Array.from(new Set([...storedExpandedItems, ...activeParents]));
  });

  // RBAC-filter groups
  const filteredGroups = useMemo(() => {
    if (isRBACLoading) return [];

    const filterByRBAC = (items: NavigationItem[]): NavigationItem[] => {
      return items
        .filter((item) => {
          if (item.roles || item.permissions) {
            return authorize({ roles: item.roles, permissions: item.permissions });
          }
          return true;
        })
        .map((item) => ({
          ...item,
          children: item.children ? filterByRBAC(item.children) : undefined,
        }))
        .filter((item) => {
          if (!item.href && item.children && item.children.length === 0) return false;
          return true;
        });
    };

    return navGroups
      .map((group) => ({ ...group, items: filterByRBAC(group.items) }))
      .filter((group) => group.items.length > 0);
  }, [navGroups, authorize, isRBACLoading]);

  // Fetch plugins and inject into nav
  const fetchPlugins = useCallback(async () => {
    try {
      // Readable by any tenant user (the full /tenant-plugins listing is ADMIN-only)
      const [plugins, appMenus] = await Promise.all([
        apiClient.get<Array<{ key: string }>>('/tenant-plugins/enabled'),
        // The tenant's live apps; without them every plugin menu stays under Modules
        apiClient.get<Array<{ key: string; name: string; plugins: string[] }>>('/tenant-apps/menu').catch(() => []),
      ]);
      const enabledPlugins = new Set<string>(plugins.map((p) => p.key));

      const filterNav = (items: NavigationItem[]): NavigationItem[] =>
        items
          .filter((item) => !item.pluginKey || enabledPlugins.has(item.pluginKey))
          .map((item) => ({ ...item, children: item.children ? filterNav(item.children) : undefined }));
      const menusOf = (key: string): NavigationItem[] => {
        const menus = PluginMenus && (PluginMenus as Record<string, NavigationItem[]>)[key];
        return Array.isArray(menus) ? menus : [];
      };

      // A plugin granted by a live app goes in that app's section (the first app by name if several)
      const owner = new Map<string, string>();
      for (const app of appMenus) for (const key of app.plugins) if (!owner.has(key)) owner.set(key, app.key);
      const appGroups = appMenus
        .map((app) => ({
          label: app.name,
          items: app.plugins.filter((key) => enabledPlugins.has(key) && owner.get(key) === app.key).flatMap(menusOf),
        }))
        .filter((group) => group.items.length > 0);

      // Plugin items not in an app are appended to the Modules group
      const pluginItems = Array.from(enabledPlugins).filter((key) => !owner.has(key)).flatMap(menusOf);
      const coreGroups = navConfig.map((g) => ({
        ...g,
        items: filterNav(g.items),
      }));

      const modulesAt = coreGroups.findIndex((g) => g.label === 'Modules');
      if (pluginItems.length > 0 && modulesAt >= 0) {
        coreGroups[modulesAt].items = [...coreGroups[modulesAt].items, ...pluginItems];
      }

      setNavGroups(
        modulesAt >= 0
          ? [...coreGroups.slice(0, modulesAt + 1), ...appGroups, ...coreGroups.slice(modulesAt + 1)]
          : [...coreGroups, ...appGroups],
      );
    } catch (error) {
      console.warn('Failed to fetch plugins for sidebar', error);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
    window.addEventListener('plugins-updated', fetchPlugins);
    return () => window.removeEventListener('plugins-updated', fetchPlugins);
  }, [fetchPlugins]);

  // Merge active route parents into expanded items on navigation
  useEffect(() => {
    if (pathname && navGroups.length > 0) {
      const activeParents = getActiveParents(flattenGroupItems(navGroups), pathname);
      setExpandedItems((prev) => {
        const merged = Array.from(new Set([...prev, ...activeParents]));
        return merged.length === prev.length && merged.every((v) => prev.includes(v)) ? prev : merged;
      });
    }
  }, [navGroups, pathname]);

  // Auto-expand sidebar on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024 && isCollapsed && setIsCollapsed) {
        setIsCollapsed(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isCollapsed, setIsCollapsed]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isOpen) setIsOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleExpand = (name: string) => {
    setExpandedItems((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
      // Defer store update to avoid "Cannot update a component while rendering" error
      queueMicrotask(() => usePreferencesStore.getState().setSidebarExpandedItems(next));
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity lg:hidden',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        className={cn(
          'print:hidden fixed inset-y-0 left-0 z-50 flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ease-out lg:static lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          isCollapsed ? 'w-16' : 'w-64',
        )}
        aria-label="Sidebar navigation"
      >
        {/* Header */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-sidebar-border transition-all duration-200',
            isCollapsed ? 'justify-center px-2' : 'justify-between px-4',
          )}
        >
          <div className={cn('flex items-center gap-3', isCollapsed && 'justify-center')}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary font-medium text-sidebar-primary-foreground shadow-sm flex-shrink-0 overflow-hidden">
              {tenantLogo ? (
                <img src={`${API_URL}${tenantLogo}`} alt={tenantName || ''} className="h-full w-full object-cover" />
              ) : (
                <Building className="h-5 w-5" />
              )}
            </div>
            {!isCollapsed && (
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-semibold leading-none tracking-tight truncate">
                  {tenantName}
                </span>
                <span className="text-tiny text-sidebar-muted-foreground truncate">
                  {tenantDescription || tenantSlug}
                </span>
              </div>
            )}
          </div>

          {/* Desktop collapse toggle */}
          {!isCollapsed && setIsCollapsed && (
            <button
              onClick={() => setIsCollapsed(true)}
              className="hidden lg:flex h-7 w-7 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}

          {/* Mobile close */}
          <button
            className="lg:hidden h-7 w-7 flex items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => setIsOpen(false)}
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* Expand toggle when collapsed */}
        {isCollapsed && setIsCollapsed && (
          <div className="hidden lg:flex justify-center py-2 border-b border-sidebar-border">
            <button
              onClick={() => setIsCollapsed(false)}
              className="h-7 w-7 flex items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="px-3 py-3" aria-label="Main navigation">
            {filteredGroups.map((group, i) => (
              <div key={group.label} className={cn(i > 0 && 'mt-4')}>
                {!isCollapsed && (
                  <h3 className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wider text-sidebar-muted-foreground">
                    {group.label}
                  </h3>
                )}
                {isCollapsed && i > 0 && (
                  <div className="mx-2 mb-2 h-px bg-sidebar-border" />
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <SidebarItem
                      key={item.name}
                      item={item}
                      expandedItems={expandedItems}
                      toggleExpand={toggleExpand}
                      pathname={pathname}
                      isCollapsed={isCollapsed}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={() => signOut()}
            className={cn(
              'flex w-full items-center rounded-md py-2 text-sm text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isCollapsed ? 'justify-center px-2' : 'px-3 gap-3',
            )}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            {!isCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
