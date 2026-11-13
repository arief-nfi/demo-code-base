/**
 * Compatibility for password hashes created while the global SanitizePipe still
 * HTML-encoded request bodies. Back then every body string was trimmed and then
 * escaped before it reached bcrypt, so a password like `p&ss` was stored as
 * bcrypt(`p&amp;ss`). The pipe is now trim-only, so those users would no longer
 * match unless we also try the legacy-encoded form (and then rehash — see
 * AuthService.matchPassword).
 */

const LEGACY_ENCODABLE = /[&<>"']/;

/** Exactly what the old SanitizePipe.sanitizeString did (order matters: `&` first). */
export function legacyHtmlEncode(value: string): string {
  return value
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** True when the old pipe would have changed this password (beyond trimming). */
export function hasLegacyEncodableChars(value: string): boolean {
  return LEGACY_ENCODABLE.test(value);
}
