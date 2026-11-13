import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useRBACStore, useRBAC } from '../stores/rbac-store';

describe('RBAC Store + useRBAC hook', () => {
  beforeEach(() => {
    // Reset store to initial state
    useRBACStore.setState({ roles: [], permissions: [], _hydrated: true });
  });

  it('defaults to empty arrays', () => {
    const { result } = renderHook(() => useRBAC());

    expect(result.current.roles).toEqual([]);
    expect(result.current.permissions).toEqual([]);
  });

  it('setRBAC updates roles and permissions', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['ADMIN'], ['system.user.read']);
    });

    const { result } = renderHook(() => useRBAC());
    expect(result.current.roles).toEqual(['ADMIN']);
    expect(result.current.permissions).toEqual(['system.user.read']);
  });

  it('clear resets to empty arrays', () => {
    act(() => {
      useRBACStore.getState().setRBAC(['ADMIN'], ['system.user.read']);
      useRBACStore.getState().clear();
    });

    const { result } = renderHook(() => useRBAC());
    expect(result.current.roles).toEqual([]);
    expect(result.current.permissions).toEqual([]);
  });

  it('isLoading is false when hydrated', () => {
    const { result } = renderHook(() => useRBAC());
    expect(result.current.isLoading).toBe(false);
  });

  describe('hasRole', () => {
    it('returns true for matching role', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['ADMIN', 'USER'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.hasRole('ADMIN')).toBe(true);
    });

    it('returns false for non-matching role', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['USER'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.hasRole('ADMIN')).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('returns true for matching permission', () => {
      act(() => {
        useRBACStore.getState().setRBAC([], ['system.user.read']);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.hasPermission('system.user.read')).toBe(true);
    });

    it('returns false for non-matching permission', () => {
      act(() => {
        useRBACStore.getState().setRBAC([], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.hasPermission('system.user.write')).toBe(false);
    });
  });

  describe('SYSADMIN bypass', () => {
    it('grants all roles to SYSADMIN', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['SYSADMIN'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.hasRole('ANY_ROLE')).toBe(true);
      expect(result.current.hasPermission('any.permission')).toBe(true);
    });

    it('SYSADMIN bypass is case-insensitive', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['sysadmin'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.hasRole('NONEXISTENT')).toBe(true);
    });
  });

  describe('authorize', () => {
    it('returns true when no roles or permissions required', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['USER'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.authorize({})).toBe(true);
    });

    it('OR logic: returns true if user has any required role', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['USER'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.authorize({ roles: ['ADMIN', 'USER'], logic: 'OR' })).toBe(true);
    });

    it('OR logic: returns true if user has any required permission', () => {
      act(() => {
        useRBACStore.getState().setRBAC([], ['system.user.read']);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.authorize({ permissions: ['system.user.read', 'system.user.write'], logic: 'OR' })).toBe(true);
    });

    it('OR logic: returns false if user has neither role nor permission', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['USER'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.authorize({ roles: ['ADMIN'], permissions: ['system.admin.write'], logic: 'OR' })).toBe(false);
    });

    it('AND logic: returns true when both role and permission match', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['ADMIN'], ['system.user.read']);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.authorize({ roles: ['ADMIN'], permissions: ['system.user.read'], logic: 'AND' })).toBe(true);
    });

    it('AND logic: returns false when role matches but permission does not', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['ADMIN'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.authorize({ roles: ['ADMIN'], permissions: ['system.user.write'], logic: 'AND' })).toBe(false);
    });

    it('SYSADMIN bypasses authorize check', () => {
      act(() => {
        useRBACStore.getState().setRBAC(['SYSADMIN'], []);
      });

      const { result } = renderHook(() => useRBAC());
      expect(result.current.authorize({ roles: ['ADMIN'], permissions: ['any.perm'], logic: 'AND' })).toBe(true);
    });
  });

  describe('refresh', () => {
    it('refresh is a no-op (backward compat)', () => {
      const { result } = renderHook(() => useRBAC());
      // Should not throw
      expect(() => result.current.refresh()).not.toThrow();
    });
  });
});
