/**
 * Network policy for Puppeteer PDF rendering of tenant-controlled template HTML.
 *
 * Templates are authored by tenant admins, so anything the headless browser
 * fetches could be used to read internal services into the PDF (SSRF). The
 * policy is deny-by-default and pure (no I/O):
 * - `continue` — Chromium may load it itself:
 *   - `data:`, `blob:` and `about:` URLs (no network involved);
 *   - passive sub-resources under a trusted asset prefix (the API's own
 *     `/uploads/` on the loopback origin — no DNS involved, see below).
 * - `fetch` — passive sub-resources (image, stylesheet, font, media) on any
 *   other http(s) URL. The renderer fetches these in Node through the pinned
 *   SSRF-safe client (`safeHttpRequestBuffer`) and fulfils the request, so
 *   Chromium never resolves the host itself (DNS-rebinding safe). The client
 *   rejects private/reserved addresses; redirects are handed back to Chromium
 *   and come through this policy again.
 * - `abort` — everything else (documents/iframes, scripts, xhr/fetch,
 *   websockets, other schemes, ...).
 */
export type RenderRequestAction = 'continue' | 'fetch' | 'abort';

export const RENDER_ALLOWED_RESOURCE_TYPES: ReadonlySet<string> = new Set(['image', 'stylesheet', 'font', 'media']);

const INLINE_PROTOCOLS = new Set(['data:', 'blob:', 'about:']);

/**
 * Tenant logos are stored as relative `/uploads/...` paths and served by this
 * API process. The PDF renderer resolves relative URLs against the API's own
 * loopback origin (see RenderingService), so trust exactly that origin's
 * `/uploads/` prefix. Chromium may load these directly: the host is a loopback
 * literal (or `localhost`, which Chromium always maps to loopback), so there is
 * no DNS answer to rebind — and the pinned client would refuse loopback anyway.
 * Static uploads are already publicly served, so this exposes nothing new.
 */
export function getTrustedAssetPrefixes(env: Record<string, string | undefined> = process.env): string[] {
  const port = env.PORT || '3001';
  return [`http://127.0.0.1:${port}/uploads/`, `http://localhost:${port}/uploads/`];
}

/** Loopback origin of this API process, used as `<base href>` when rendering PDFs. */
export function getApiLoopbackOrigin(env: Record<string, string | undefined> = process.env): string {
  return `http://127.0.0.1:${env.PORT || '3001'}`;
}

function isUnderTrustedPrefix(url: URL, prefixes: string[]): boolean {
  if (url.username || url.password) return false;
  return prefixes.some((prefix) => {
    const trusted = new URL(prefix);
    return url.origin === trusted.origin && url.pathname.startsWith(trusted.pathname);
  });
}

export function classifyRenderRequest(
  rawUrl: string,
  resourceType: string,
  trustedPrefixes: string[] = getTrustedAssetPrefixes(),
): RenderRequestAction {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'abort';
  }

  if (INLINE_PROTOCOLS.has(url.protocol)) return 'continue';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'abort';
  if (!RENDER_ALLOWED_RESOURCE_TYPES.has(resourceType)) return 'abort';
  if (isUnderTrustedPrefix(url, trustedPrefixes)) return 'continue';
  return 'fetch';
}
