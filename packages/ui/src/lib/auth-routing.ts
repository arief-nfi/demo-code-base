/**
 * Page-level auth routing for apps/web/proxy.ts, imported directly
 * (`@saas/ui/src/lib/auth-routing`), so like ./jwt this module must stay free of
 * React and of `'use client'`.
 *
 * Only cookie *presence* is checked here — a cheap UX shortcut so a visitor
 * without a session lands on /login before any dashboard markup renders. Whether
 * a session is actually valid is decided by the API: the dashboard's AuthGate
 * holds the page until `/auth/me` succeeds, and the api-client sends 401s to /login.
 */

import { isJwtUnexpired } from './jwt';

/** Pages reachable without a session (each also matches its sub-paths). */
export const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/contact-sales',
  '/tenant-suspended',
  // Fake (test-mode) payment page: opened by URL like a hosted checkout; the checkout id is the secret
  '/pay',
];

/**
 * Non-secret cookie the web app sets on its own host while signed in (see
 * ./session-hint). The API's HttpOnly cookies only reach the web host when both
 * share a host or COOKIE_DOMAIN; with web and API on separate subdomains and no
 * COOKIE_DOMAIN, this hint is the only session signal the proxy can see.
 */
export const SESSION_HINT_COOKIE = 'has_session';

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export interface AuthRouteRequest {
  pathname: string;
  /** Raw query string including the leading `?`, or `''`. */
  search: string;
  /** Value of the `token` (access JWT) cookie. */
  token?: string;
  /** Value of the `refresh_token` cookie. */
  refreshToken?: string;
  /** Value of the SESSION_HINT_COOKIE cookie. */
  sessionHint?: string;
}

/**
 * Where to redirect a page request, or null to let it through:
 * - a protected page with no session cookie or hint → `/login?returnUrl=<path+search>`
 * - /login or /register with an unexpired access token → `/`
 *
 * The /login bounce needs an *unexpired* token, not just any cookie: a stale
 * refresh_token alone would otherwise bounce /login → / → (401) → /login forever.
 */
export function authRedirect(req: AuthRouteRequest, nowMs: number = Date.now()): string | null {
  const { pathname, search, token, refreshToken, sessionHint } = req;

  if (pathname === '/login' || pathname === '/register') {
    return isJwtUnexpired(token, nowMs) ? '/' : null;
  }
  if (isPublicPath(pathname)) return null;
  if (token || refreshToken || sessionHint) return null;

  return `/login?returnUrl=${encodeURIComponent(pathname + search)}`;
}
