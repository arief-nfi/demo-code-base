import { BadRequestException } from '@nestjs/common';
import { validateMeetingCreate, validateMeetingRef } from '../meetings-validation';

const ref = { tenantSlug: 'acme', source: 'sample-plugin', key: 'article-review:42' };
const input = { ...ref, hostUserId: 'u1', title: 'Review: Hello', access: 'TRUSTED' as const };

describe('validateMeetingRef / validateMeetingCreate', () => {
  it('accepts a plugin key as source and a free-form key', () => {
    expect(() => validateMeetingRef(ref)).not.toThrow();
    expect(() => validateMeetingCreate(input)).not.toThrow();
    expect(() => validateMeetingCreate({ ...ref, hostUserId: 'u1' })).not.toThrow();
  });

  it.each([
    ['a source with capitals', { ...input, source: 'Sample' }],
    ['a source with slashes', { ...input, source: 'a/b' }],
    ['an empty key', { ...input, key: '' }],
    ['a 201-character key', { ...input, key: 'k'.repeat(201) }],
    ['an empty tenant', { ...input, tenantSlug: '' }],
    ['an empty host', { ...input, hostUserId: '' }],
    ['a 201-character title', { ...input, title: 'x'.repeat(201) }],
    ['an unknown access', { ...input, access: 'PUBLIC' }],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateMeetingCreate(bad as any)).toThrow(BadRequestException);
  });

  it('validates the reference on its own for get and cancel', () => {
    expect(() => validateMeetingRef({ ...ref, key: '' })).toThrow(BadRequestException);
    expect(() => validateMeetingRef({ ...ref, source: 'Bad' })).toThrow(BadRequestException);
  });
});
