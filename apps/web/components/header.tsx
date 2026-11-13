'use client';

import Link from 'next/link';
import { Menu, LogOut, User2, Search } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { NotificationBell } from './notification-bell';
import { Breadcrumbs } from './breadcrumbs';
import { useState, useEffect } from 'react';
import { useLanguage, useAuthStore, signOut } from '@saas/ui';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  Separator,
} from '@saas/ui';
import { getImageUrl } from '@/lib/utils';

interface HeaderProps {
  onMenuClick: () => void;
  onCommandOpen?: () => void;
}

export function Header({ onMenuClick, onCommandOpen }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const { t } = useLanguage();
  const username = useAuthStore(s => s.username);
  const name = useAuthStore(s => s.name);
  const tenantSlug = useAuthStore(s => s.tenantSlug);
  const avatar = useAuthStore(s => s.avatar);

  // Shadow on scroll
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const handleScroll = () => setScrolled(main.scrollTop > 0);
    main.addEventListener('scroll', handleScroll, { passive: true });
    return () => main.removeEventListener('scroll', handleScroll);
  }, []);

  const initials = username
    ? username.charAt(0).toUpperCase()
    : '?';

  return (
    <header
      className={`print:hidden sticky top-0 z-30 flex h-14 shrink-0 items-center gap-x-4 border-b bg-card-header backdrop-blur-md px-4 sm:px-6 lg:px-8 transition-shadow duration-200 ${
        scrolled ? 'shadow-md border-border' : 'shadow-xs border-border'
      }`}
    >
      {/* Mobile menu */}
      <button
        type="button"
        className="-m-2.5 p-2.5 text-muted-foreground hover:text-foreground lg:hidden"
        onClick={onMenuClick}
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Breadcrumbs (desktop) */}
      <div className="hidden md:block">
        <Breadcrumbs />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-x-2">
        {/* Command palette trigger */}
        {onCommandOpen && (
          <button
            onClick={onCommandOpen}
            className="hidden sm:inline-flex items-center gap-2 rounded-md border border-input bg-background/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Open command palette"
          >
            <Search className="h-4 w-4" />
            <span className="hidden lg:inline">Search...</span>
            <kbd className="hidden lg:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <span className="text-xs">⌘</span>K
            </kbd>
          </button>
        )}

        {/* Notifications */}
        <NotificationBell />

        {/* Theme toggle */}
        <ThemeToggle />

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <span className="sr-only">Open user menu</span>
              <Avatar size="sm">
                {avatar && <AvatarImage src={getImageUrl(avatar)} alt={username || 'User'} />}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{name || username || 'User'}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {username && tenantSlug ? `${username}@${tenantSlug}` : ''}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account/profile" className="cursor-pointer">
                <User2 className="mr-2 h-4 w-4" />
                {t('common.profile')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()} variant="destructive" className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              {t('common.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
