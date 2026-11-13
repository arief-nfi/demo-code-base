import { SESSION_HINT_COOKIE } from './auth-routing';

/** Refreshed on every successful session check, so an active user never loses it. */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function write(value: string, maxAge: number): void {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SESSION_HINT_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * Mark this browser as signed in, on the web app's own host, so apps/web/proxy.ts
 * lets dashboard pages through even when the API's cookies live on another host.
 * Not a credential: the API still decides on every request.
 */
export function setSessionHint(): void {
  write('1', MAX_AGE_SECONDS);
}

export function clearSessionHint(): void {
  write('', 0);
}
