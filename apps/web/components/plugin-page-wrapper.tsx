'use client';

import { useRouter } from 'next/navigation';
import type React from 'react';

interface PluginPageWrapperProps {
  Component: React.ComponentType<{
    onNavigate?: (path: string) => void;
    params?: Record<string, string>;
    searchParams?: Record<string, string>;
  }>;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
}

export function PluginPageWrapper({ Component, params, searchParams }: PluginPageWrapperProps) {
  const router = useRouter();

  const onNavigate = (path: string) => {
    router.push(path);
  };

  return <Component onNavigate={onNavigate} params={params} searchParams={searchParams} />;
}
