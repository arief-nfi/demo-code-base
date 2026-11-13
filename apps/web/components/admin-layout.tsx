'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { PageTransition } from './page-transition';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  useHotkey,
} from '@saas/ui';
import { useRBAC, usePreferencesStore } from '@saas/ui';
import { useTheme } from 'next-themes';
import { navigation, flattenNavigation } from '@/config/navigation';
import { useNavigationStore } from '@/stores/navigation-store';

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarCollapsed = usePreferencesStore(s => s.sidebarCollapsed);
  const [commandOpen, setCommandOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { authorize } = useRBAC();
  const { setTheme, resolvedTheme } = useTheme();

  // Scroll to top on navigation
  useEffect(() => {
    document.getElementById('main-content')?.scrollTo(0, 0);
  }, [pathname]);

  const handleSetIsCollapsed = (value: boolean) => {
    usePreferencesStore.getState().setSidebarCollapsed(value);
  };

  // Keyboard shortcuts
  useHotkey('mod+k', useCallback(() => setCommandOpen((prev) => !prev), []));
  useHotkey('mod+/', useCallback(() => handleSetIsCollapsed(!sidebarCollapsed), [sidebarCollapsed]));
  useHotkey('mod+.', useCallback(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'), [resolvedTheme, setTheme]));

  const handleCommandSelect = useCallback(
    (href: string) => {
      setCommandOpen(false);
      router.push(href);
    },
    [router],
  );

  // Use plugin-aware nav from store, fall back to static config
  const navGroups = useNavigationStore(s => s.navGroups);
  const activeNavigation = navGroups.length > 0 ? navGroups : navigation;

  // Filter command palette items by RBAC
  const commandItems = flattenNavigation(activeNavigation).filter((item) => {
    if (item.roles || item.permissions) {
      return authorize({ roles: item.roles, permissions: item.permissions });
    }
    return true;
  });

  return (
    <div className="flex h-screen overflow-hidden bg-muted/10 print:block print:h-auto print:overflow-visible">
      {/* Skip-to-content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to content
      </a>

      <Sidebar
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        isCollapsed={sidebarCollapsed}
        setIsCollapsed={handleSetIsCollapsed}
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0 print:overflow-visible">
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          onCommandOpen={() => setCommandOpen(true)}
        />
        <main id="main-content" className="flex-1 overflow-y-auto scrollbar-custom-light dark:scrollbar-custom print:overflow-visible">
          <div className="px-4 py-4 sm:px-6 sm:py-4 lg:px-8 lg:py-6">
            <PageTransition>
              {children}
            </PageTransition>
          </div>
        </main>
      </div>

      {/* Command Palette */}
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search pages..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            {commandItems.map((item) => (
              <CommandItem
                key={item.href}
                onSelect={() => handleCommandSelect(item.href!)}
                className="cursor-pointer"
              >
                <item.icon className="mr-2 h-4 w-4" />
                {item.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
