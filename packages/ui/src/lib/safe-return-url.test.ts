import { describe, it, expect } from 'vitest';
import { safeReturnUrl } from './safe-return-url';

/** What the login page does: read `returnUrl` from the (already decoded) query string. */
const fromQuery = (rawQuery: string) => safeReturnUrl(new URLSearchParams(rawQuery).get('returnUrl'));

describe('safeReturnUrl', () => {
  it.each([
    '/',
    '/systems/users',
    '/systems/users?x=1',
    '/systems/users?search=john%20doe#top',
    '/plugins/sample-plugin/items/abc-123',
  ])('keeps same-origin relative path %j', (value) => {
    expect(safeReturnUrl(value)).toBe(value);
  });

  it('round-trips what the api-client redirect produces', () => {
    const current = '/systems/users?search=john%20doe&page=2';
    expect(fromQuery(`returnUrl=${encodeURIComponent(current)}`)).toBe(current);
  });

  it.each([null, undefined, ''])('falls back to / for %j', (value) => {
    expect(safeReturnUrl(value)).toBe('/');
  });

  it.each([
    'http://x',
    'https://evil.com/path',
    'HTTP://evil.com',
    'http://127.0.0.1:59123/',
  ])('rejects absolute URL %j', (value) => {
    expect(safeReturnUrl(value)).toBe('/');
  });

  it.each(['//evil.com', '///evil.com', '//evil.com/systems'])(
    'rejects protocol-relative URL %j',
    (value) => {
      expect(safeReturnUrl(value)).toBe('/');
    },
  );

  it.each(['/\\evil.com', '\\\\evil.com', '\\/evil.com', '/systems\\..\\evil'])(
    'rejects backslash trick %j',
    (value) => {
      expect(safeReturnUrl(value)).toBe('/');
    },
  );

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:a@b.c',
  ])('rejects scheme %j', (value) => {
    expect(safeReturnUrl(value)).toBe('/');
  });

  it.each(['evil.com', 'systems/users', '.', '../x'])('rejects non-rooted path %j', (value) => {
    expect(safeReturnUrl(value)).toBe('/');
  });

  // URL parsers strip tab/newline and trim leading control chars/spaces,
  // so e.g. "/\t/evil.com" would be navigated to as "//evil.com".
  it.each(['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', ' //evil.com', '\u0000//evil.com', '/\u0000', '/systems users'])(
    'rejects control-char / whitespace trick %j',
    (value) => {
      expect(safeReturnUrl(value)).toBe('/');
    },
  );

  it.each([
    'returnUrl=%2F%2Fevil.com', // -> //evil.com
    'returnUrl=%2F%5Cevil.com', // -> /\evil.com
    'returnUrl=http%3A%2F%2Fevil.com', // -> http://evil.com
    'returnUrl=javascript%3Aalert(1)', // -> javascript:alert(1)
    'returnUrl=%2F%09%2Fevil.com', // -> /<tab>/evil.com
  ])('rejects percent-encoded attack once decoded from the query (%s)', (query) => {
    expect(fromQuery(query)).toBe('/');
  });

  // Dot segments that normalise to a "//host" path: same-origin as a path today,
  // but protocol-relative if the value is ever used to build a full URL.
  it.each([
    '/.//evil.com',
    '/%2e//evil.com',
    '/%2E//evil.com',
    '/a/..//evil.com',
    '/a/%2e%2e//evil.com',
    '/..//evil.com',
  ])('rejects dot-segment path normalising to //host %j', (value) => {
    expect(safeReturnUrl(value)).toBe('/');
  });

  it('returns the normalised path + search + hash', () => {
    expect(safeReturnUrl('/systems/./users/../roles?x=1#h')).toBe('/systems/roles?x=1#h');
    expect(safeReturnUrl('/a/%2e/b')).toBe('/a/b');
  });

  it.each([
    '%2F%2Fevil.com', // not rooted
    '/%2F/evil.com', // decodes to //evil.com
    '/%2F%2Fevil.com', // decodes to ///evil.com
    '/%5Cevil.com', // decodes to /\evil.com
    '/%E0%A4%A', // malformed escape
  ])('rejects still-encoded value %j', (value) => {
    expect(safeReturnUrl(value)).toBe('/');
  });
});
