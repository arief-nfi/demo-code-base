import { describe, it, expect, vi, afterEach } from 'vitest';
import { signOut } from './api-client';
import { useAuthStore } from '../stores/auth-store';
import { useRBACStore } from '../stores/rbac-store';

describe('signOut', () => {
  afterEach(() => vi.unstubAllGlobals());

  function signIn() {
    useAuthStore.getState().setSession({ tenantId: 't1', tenantSlug: 'acme', tenantName: 'Acme', username: 'boss' });
    useRBACStore.getState().setRBAC(['ADMIN'], ['system.user.read']);
  }

  it('revokes the session on the API and clears local auth state', async () => {
    signIn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    // jsdom cannot navigate; it reports the attempted /login navigation as "not implemented".
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await signOut();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/logout$/), expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect(useAuthStore.getState().tenantSlug).toBeNull();
    expect(useRBACStore.getState().roles).toEqual([]);
    expect(document.cookie).not.toContain('has_session=1');
  });

  it('still clears local auth state when the API is unreachable', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await signOut();

    expect(useAuthStore.getState().tenantSlug).toBeNull();
    expect(useRBACStore.getState().roles).toEqual([]);
  });
});
