/**
 * Sanitize a post-login `returnUrl` so it can only point inside this app.
 *
 * Returns the normalised path + search + hash when `value` is a same-origin
 * relative path (e.g. `/systems/users?x=1`). Anything else — absolute or
 * protocol-relative URLs, backslash tricks, `javascript:` and other schemes,
 * control characters or whitespace, dot segments collapsing to `//host` — falls
 * back to `'/'`. Prevents open redirects such as
 * `/login?returnUrl=https://evil.example`.
 */
export function safeReturnUrl(value: string | null | undefined): string {
  return (value && normalizeSameOriginPath(value)) || '/';
}

// URL parsers strip tab/newline anywhere and trim leading control chars/spaces,
// so "/\t/evil.com" is navigated to as "//evil.com". Legit paths are encoded.
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f]/;

const PROBE_ORIGIN = 'http://return-url.invalid';

function normalizeSameOriginPath(value: string): string | null {
  if (UNSAFE_CHARS.test(value)) return null;

  // One leading "/" only: "//host" is protocol-relative, and browsers treat "\" as "/".
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;

  // Same prefix check one decoding layer down ("/%2F/evil.com", "/%5Cevil.com").
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) return null;

  // Final arbiter: resolving against a probe origin must not leave it, and the
  // normalised path must not turn protocol-relative ("/a/..//evil.com" → "//evil.com").
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  if (url.pathname.startsWith('//') || url.pathname.includes('\\')) return null;

  return url.pathname + url.search + url.hash;
}
