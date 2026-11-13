import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RBACData {
  roles: string[];
  permissions: string[];
}

interface AuthorizeOptions {
  roles?: string[];
  permissions?: string[];
  logic?: 'AND' | 'OR';
}

interface RBACState {
  roles: string[];
  permissions: string[];
  _hydrated: boolean;

  setRBAC: (roles: string[], permissions: string[]) => void;
  clear: () => void;
}

const SYSADMIN = 'SYSADMIN';

export const useRBACStore = create<RBACState>()(
  persist(
    (set) => ({
      roles: [],
      permissions: [],
      _hydrated: true,

      setRBAC: (roles, permissions) => set({ roles, permissions }),
      clear: () => set({ roles: [], permissions: [] }),
    }),
    {
      name: 'rbac-storage',
      partialize: (state) => ({
        roles: state.roles,
        permissions: state.permissions,
      }),
    },
  ),
);

// ─── useRBAC hook (same API as the old RBACProvider context) ─────────────

function hasRoleFn(roles: string[], role: string): boolean {
  return roles.includes(role) || roles.some(r => r.toUpperCase() === SYSADMIN);
}

function hasPermissionFn(roles: string[], permissions: string[], permission: string): boolean {
  return permissions.includes(permission) || roles.some(r => r.toUpperCase() === SYSADMIN);
}

function authorizeFn(
  roles: string[],
  permissions: string[],
  { roles: requiredRoles = [], permissions: requiredPermissions = [], logic = 'OR' }: AuthorizeOptions,
): boolean {
  if (roles.some(r => r.toUpperCase() === SYSADMIN)) return true;
  if (requiredRoles.length === 0 && requiredPermissions.length === 0) return true;

  const roleMatch = requiredRoles.length > 0 && requiredRoles.some(r => hasRoleFn(roles, r));
  const permissionMatch = requiredPermissions.length > 0 && requiredPermissions.some(p => hasPermissionFn(roles, permissions, p));

  if (logic === 'OR') return roleMatch || permissionMatch;

  const roleSatisfied = requiredRoles.length === 0 || roleMatch;
  const permissionSatisfied = requiredPermissions.length === 0 || permissionMatch;
  return roleSatisfied && permissionSatisfied;
}

export function useRBAC() {
  const roles = useRBACStore(s => s.roles);
  const permissions = useRBACStore(s => s.permissions);
  const hydrated = useRBACStore(s => s._hydrated);

  return {
    roles,
    permissions,
    isLoading: !hydrated,
    hasRole: (role: string) => hasRoleFn(roles, role),
    hasPermission: (permission: string) => hasPermissionFn(roles, permissions, permission),
    authorize: (options: AuthorizeOptions) => authorizeFn(roles, permissions, options),
    refresh: () => {
      // No-op for backward compat — stores auto-react to state changes
    },
  };
}
