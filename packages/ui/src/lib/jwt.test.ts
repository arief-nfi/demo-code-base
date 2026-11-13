import { describe, it, expect, afterEach, vi } from 'vitest';
import { decodeJwtPayload, isJwtUnexpired } from './jwt';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const makeJwt = (payload: unknown) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.signature`;

const NOW_MS = Date.UTC(2026, 0, 1);
const NOW_S = NOW_MS / 1000;

describe('decodeJwtPayload', () => {
  it('decodes the payload of a well-formed JWT', () => {
    const payload = { sub: 'user-1', tenantSlug: 'acme', exp: NOW_S + 900 };
    expect(decodeJwtPayload(makeJwt(payload))).toEqual(payload);
  });

  it('handles base64url alphabet and missing padding', () => {
    const payload = { x: '>>>???', y: 'ab' };
    const segment = b64url(JSON.stringify(payload));
    expect(segment).toMatch(/[-_]/); // sanity: exercises the url-safe alphabet
    expect(segment).not.toContain('=');
    expect(decodeJwtPayload(makeJwt(payload))).toEqual(payload);
  });

  it('decodes UTF-8 claims', () => {
    expect(decodeJwtPayload(makeJwt({ name: 'José Ñandú' }))).toEqual({ name: 'José Ñandú' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['one part', 'abc'],
    ['two parts', 'a.b'],
    ['four parts', 'a.b.c.d'],
    ['empty payload', 'a..c'],
    ['not base64', 'a.!!!.c'],
    ['not JSON', `a.${b64url('not json')}.c`],
    ['JSON number', `a.${b64url('123')}.c`],
    ['JSON null', `a.${b64url('null')}.c`],
    ['JSON array', `a.${b64url('[1,2]')}.c`],
  ])('returns null for %s', (_label, token) => {
    expect(decodeJwtPayload(token)).toBeNull();
  });
});

describe('isJwtUnexpired', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is true when exp is in the future', () => {
    expect(isJwtUnexpired(makeJwt({ exp: NOW_S + 60 }), NOW_MS)).toBe(true);
  });

  it('is false when exp is in the past or exactly now', () => {
    expect(isJwtUnexpired(makeJwt({ exp: NOW_S - 1 }), NOW_MS)).toBe(false);
    expect(isJwtUnexpired(makeJwt({ exp: NOW_S }), NOW_MS)).toBe(false);
  });

  it('is false when exp is missing or not a number', () => {
    expect(isJwtUnexpired(makeJwt({ sub: 'user-1' }), NOW_MS)).toBe(false);
    expect(isJwtUnexpired(makeJwt({ exp: String(NOW_S + 60) }), NOW_MS)).toBe(false);
    expect(isJwtUnexpired(makeJwt({ exp: null }), NOW_MS)).toBe(false);
  });

  it.each([null, undefined, '', 'not-a-jwt', 'a.!!!.c'])('is false for malformed token %j', (token) => {
    expect(isJwtUnexpired(token, NOW_MS)).toBe(false);
  });

  it('defaults to the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    expect(isJwtUnexpired(makeJwt({ exp: NOW_S + 60 }))).toBe(true);
    expect(isJwtUnexpired(makeJwt({ exp: NOW_S - 60 }))).toBe(false);
  });
});
