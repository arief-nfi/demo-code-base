'use client';

import React from 'react';
import { useRBAC } from '../stores/rbac-store';

interface ProtectProps {
  children: React.ReactNode;
  roles?: string[];
  permissions?: string[];
  fallback?: React.ReactNode;
  logic?: 'AND' | 'OR';
}

export function Protect({ children, roles, permissions, fallback = null, logic = 'OR' }: ProtectProps) {
  const { authorize, isLoading } = useRBAC();

  if (isLoading) {
    return null;
  }

  if (authorize({ roles, permissions, logic })) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
