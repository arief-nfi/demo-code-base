'use client';

import React, { useEffect, useRef, useState } from 'react';
import { isAuthRedirectError } from '../lib/api-client';

export interface AuthGateProps<T> {
  /** Load the current session, e.g. `() => apiClient.get('/auth/me')`. */
  loadSession: () => Promise<T>;
  /**
   * Apply the session (stores, RBAC) before the children first render.
   * Return `false` to keep showing `fallback`, e.g. while redirecting elsewhere.
   */
  onSession?: (session: T) => boolean | void;
  /**
   * Shown on the server, while loading, and while the api-client redirects
   * away (401 → /login, suspended tenant). Must not reveal protected UI.
   */
  fallback: React.ReactNode;
  /**
   * Shown when the session could not be loaded for any other reason. It stays
   * up while a retry runs (`state.retrying`), so retrying never flashes the
   * fallback.
   */
  renderError: (retry: () => void, state: AuthGateErrorState) => React.ReactNode;
  children: React.ReactNode;
}

export interface AuthGateErrorState {
  /** What the last attempt threw (or what onSession threw). */
  error: unknown;
  /** A retry is in flight. */
  retrying: boolean;
  /** Attempts that failed in a row, starting at 1. */
  failures: number;
}

type GateStatus = 'loading' | 'ready' | 'holding' | 'error';

/**
 * Renders `children` only once the session has loaded, so protected UI never
 * flashes for a visitor whose session turns out to be invalid, and pages never
 * render (or call `forbidden()`) before RBAC is known. Runs once per mount;
 * client-side navigations under the same layout keep the loaded state.
 */
export function AuthGate<T>({ loadSession, onSession, fallback, renderError, children }: AuthGateProps<T>) {
  const [status, setStatus] = useState<GateStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ error: unknown; failures: number } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const latest = useRef({ loadSession, onSession });
  latest.current = { loadSession, onSession };

  useEffect(() => {
    let cancelled = false;
    const fail = (error: unknown) => {
      setFailure((prev) => ({ error, failures: (prev?.failures ?? 0) + 1 }));
      setRetrying(false);
      setStatus('error');
    };
    latest.current.loadSession().then(
      (session) => {
        if (cancelled) return;
        try {
          setStatus(latest.current.onSession?.(session) === false ? 'holding' : 'ready');
        } catch (err) {
          console.error('[auth] applying the session failed', err);
          fail(err);
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        if (isAuthRedirectError(err)) setStatus('holding');
        else fail(err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (status === 'ready') return <>{children}</>;
  if (status === 'error' && failure) {
    return (
      <>
        {renderError(
          () => {
            if (retrying) return;
            setRetrying(true);
            setAttempt((n) => n + 1);
          },
          { error: failure.error, retrying, failures: failure.failures },
        )}
      </>
    );
  }
  return <>{fallback}</>;
}
