'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';
import { routeLabels } from '@/config/navigation';

/** Check if a segment looks like a UUID or numeric ID */
function isDynamicSegment(segment: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) || /^\d+$/.test(segment);
}

/** Get human-readable label for a route segment */
function getLabel(href: string, segment: string): string {
  if (routeLabels[href]) return routeLabels[href];
  if (isDynamicSegment(segment)) return 'Details';
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return (
      <nav className="flex" aria-label="Breadcrumb">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <Home className="h-4 w-4" />
          <span className="sr-only">Home</span>
        </Link>
      </nav>
    );
  }

  return (
    <nav className="flex" aria-label="Breadcrumb">
      <ol className="flex items-center space-x-1.5">
        <li>
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <Home className="h-4 w-4" />
            <span className="sr-only">Home</span>
          </Link>
        </li>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join('/')}`;
          const isLast = index === segments.length - 1;
          const label = getLabel(href, segment);

          return (
            <li key={href} className="flex items-center">
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50" aria-hidden="true" />
              {isLast ? (
                <span className="ml-1.5 text-sm font-medium text-foreground" aria-current="page">
                  {label}
                </span>
              ) : (
                <Link
                  href={href}
                  className="ml-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
