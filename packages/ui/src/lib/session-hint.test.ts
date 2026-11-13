import { describe, it, expect, beforeEach } from 'vitest';
import { setSessionHint, clearSessionHint } from './session-hint';
import { SESSION_HINT_COOKIE } from './auth-routing';
import { useAuthStore } from '../stores/auth-store';

const hint = () =>
  document.cookie.split('; ').find((c) => c.startsWith(`${SESSION_HINT_COOKIE}=`))?.split('=')[1];

describe('session hint cookie', () => {
  beforeEach(() => clearSessionHint());

  it('setSessionHint writes a non-empty cookie the proxy can read', () => {
    setSessionHint();
    expect(hint()).toBe('1');
  });

  it('clearSessionHint removes it', () => {
    setSessionHint();
    clearSessionHint();
    expect(hint()).toBeUndefined();
  });

  it('is set by useAuthStore.setSession (every login path) and cleared by clearSession (every logout/401 path)', () => {
    useAuthStore.getState().setSession({
      tenantId: 't1',
      tenantSlug: 'acme',
      tenantName: 'Acme',
      username: 'boss',
    });
    expect(hint()).toBe('1');

    useAuthStore.getState().clearSession();
    expect(hint()).toBeUndefined();
  });
});
