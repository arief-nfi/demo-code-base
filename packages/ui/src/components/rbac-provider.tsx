'use client';

// Re-export useRBAC and RBACData from the Zustand store for backward compatibility.
// The RBACProvider wrapper is kept as a pass-through so existing <RBACProvider> usage
// in tests and layouts doesn't break, but it no longer manages state — the store does.

export { useRBAC } from '../stores/rbac-store';
export type { RBACData } from '../stores/rbac-store';

/**
 * @deprecated RBAC state is now managed by useRBACStore. This component is a
 * no-op pass-through kept for backward compatibility with existing layouts/tests.
 */
export function RBACProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
