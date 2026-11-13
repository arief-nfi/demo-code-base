'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { TenantThemeProvider } from '../tenant-theme-provider';
import { DynamicFavicon } from '../dynamic-favicon';

export function KioskLayout({ children }: { children: React.ReactNode }) {
  const [showExit, setShowExit] = useState(false);

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-background"
      onMouseMove={(e) => {
        // Show exit button when mouse is near bottom-right corner
        const nearCorner = e.clientX > window.innerWidth - 100 && e.clientY > window.innerHeight - 100;
        setShowExit(nearCorner);
      }}
    >
      <TenantThemeProvider />
      <DynamicFavicon />

      {/* Full viewport content */}
      <main className="h-full w-full">
        {children}
      </main>

      {/* Exit button — appears when mouse is near bottom-right */}
      {showExit && (
        <Link
          href="/"
          className="fixed bottom-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 border border-border shadow-lg backdrop-blur-sm hover:bg-accent transition-colors"
          title="Exit to Dashboard"
        >
          <X className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
