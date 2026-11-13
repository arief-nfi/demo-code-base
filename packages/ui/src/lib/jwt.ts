/**
 * Dependency-free JWT helpers. Imported directly by apps/web/proxy.ts
 * (`@saas/ui/src/lib/jwt`), so this module must stay free of imports and of
 * `'use client'` — the package index pulls React client components.
 *
 * NOTHING here verifies signatures. Use only for UX shortcuts (e.g. "is there
 * probably a live session?"), never for authorization — the API decides that.
 */

/**
 * Decode a JWT's payload without verifying it. Returns null for anything that
 * isn't a three-part token whose payload is a base64url-encoded JSON object.
 */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * True when `token` is a JWT whose numeric `exp` claim (seconds) is still in
 * the future. Malformed tokens and a missing/non-numeric `exp` count as expired.
 */
export function isJwtUnexpired(token: string | null | undefined, nowMs: number = Date.now()): boolean {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) && exp * 1000 > nowMs;
}
