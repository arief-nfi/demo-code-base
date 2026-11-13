import { describe, it, expect } from 'vitest';
import { authRedirect, isPublicPath } from './auth-routing';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const makeJwt = (payload: unknown) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.signature`;

const NOW_MS = Date.UTC(2026, 0, 1);
const NOW_S = NOW_MS / 1000;
const LIVE = makeJwt({ sub: 'u1', exp: NOW_S + 900 });
const EXPIRED = makeJwt({ sub: 'u1', exp: NOW_S - 1 });

const at = (pathname: string, cookies: { token?: string; refreshToken?: string; sessionHint?: string } = {}, search = '') =>
  authRedirect({ pathname, search, ...cookies }, NOW_MS);

describe('isPublicPath', () => {
  it.each(['/login', '/register', '/forgot-password', '/reset-password', '/contact-sales', '/tenant-suspended', '/pay'])(
    '%s is public',
    (p) => expect(isPublicPath(p)).toBe(true),
  );

  it('matches nested segments of a public path', () => {
    expect(isPublicPath('/reset-password/abc123')).toBe(true);
  });

  it('the fake payment page is public (opened by URL like a hosted checkout)', () => {
    expect(isPublicPath('/pay/0f8c2a4e-1b2c-4d5e-8f90-123456789abc')).toBe(true);
    expect(authRedirect({ pathname: '/pay/abc', search: '' })).toBeNull();
  });

  it.each(['/', '/systems/users', '/onboarding', '/loginx', '/login-help', '/plugins/sample/items'])(
    '%s is not public',
    (p) => expect(isPublicPath(p)).toBe(false),
  );
});

describe('authRedirect', () => {
  it('sends a protected page with no session cookies to /login, keeping the return path', () => {
    expect(at('/systems/users', {}, '?page=2')).toBe('/login?returnUrl=%2Fsystems%2Fusers%3Fpage%3D2');
  });

  it('sends the dashboard root with no session cookies to /login', () => {
    expect(at('/')).toBe('/login?returnUrl=%2F');
  });

  it('treats /onboarding as protected (it needs a session)', () => {
    expect(at('/onboarding')).toBe('/login?returnUrl=%2Fonboarding');
  });

  it('treats empty cookie values as absent', () => {
    expect(at('/', { token: '', refreshToken: '' })).toBe('/login?returnUrl=%2F');
  });

  it('lets a protected page through when only the access token cookie exists', () => {
    expect(at('/systems/users', { token: EXPIRED })).toBeNull();
  });

  it('lets a protected page through when only the refresh token cookie exists (access token expired)', () => {
    expect(at('/systems/users', { refreshToken: 'opaque' })).toBeNull();
  });

  it("lets a protected page through on the web app's session hint alone (API cookies on another host)", () => {
    expect(at('/systems/users', { sessionHint: '1' })).toBeNull();
  });

  it('does not bounce /login on the session hint alone (only an unexpired token does)', () => {
    expect(at('/login', { sessionHint: '1' })).toBeNull();
  });

  it('never redirects public pages for a visitor without cookies', () => {
    expect(at('/login')).toBeNull();
    expect(at('/forgot-password')).toBeNull();
    expect(at('/reset-password/abc')).toBeNull();
  });

  it('bounces /login and /register to / when the access token is unexpired', () => {
    expect(at('/login', { token: LIVE })).toBe('/');
    expect(at('/register', { token: LIVE })).toBe('/');
  });

  it('keeps /login when the access token is expired, even with a refresh token (no reload loop)', () => {
    expect(at('/login', { token: EXPIRED, refreshToken: 'opaque' })).toBeNull();
    expect(at('/login', { refreshToken: 'opaque' })).toBeNull();
  });

  it('does not bounce other public pages for a live session', () => {
    expect(at('/tenant-suspended', { token: LIVE })).toBeNull();
    expect(at('/forgot-password', { token: LIVE })).toBeNull();
  });
});
