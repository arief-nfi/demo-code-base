import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
// Deep import on purpose: the @saas/ui index pulls React client components into
// the proxy bundle. This module is dependency-free (and unit-tested there).
import { authRedirect, SESSION_HINT_COOKIE } from '@saas/ui/src/lib/auth-routing'

/**
 * Page-level auth redirects, before anything renders (see authRedirect):
 * - no session cookie or session hint on a protected page → /login?returnUrl=…,
 *   so a signed-out visitor never sees the dashboard shell flash first;
 * - an unexpired access token on /login or /register → /.
 *
 * The API's cookies are only visible here when web and API share a host (or
 * COOKIE_DOMAIN); the web app's own session-hint cookie covers split hosts.
 * Cookies are only checked for presence/expiry (decoded, NOT verified — the API
 * stays the authority). Cookies that exist but no longer work (revoked refresh
 * token, rotated secret) pass through here and are caught by the dashboard's
 * AuthGate, which shows a loading screen until /auth/me succeeds.
 *
 * This also runs for client-side navigations (RSC fetches): Next strips the
 * `rsc` header and `_rsc` param before the proxy sees them, and its router
 * follows the redirect.
 */
export function proxy(request: NextRequest) {
  const target = authRedirect({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    token: request.cookies.get('token')?.value,
    refreshToken: request.cookies.get('refresh_token')?.value,
    sessionHint: request.cookies.get(SESSION_HINT_COOKIE)?.value,
  })
  return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next()
}

export const config = {
  // Every page; not Next internals (/_next, dev overlay /__nextjs*) or files.
  matcher: ['/((?!_next/|__nextjs|favicon\\.ico|uploads/|.*\\.\\w+$).*)'],
}
