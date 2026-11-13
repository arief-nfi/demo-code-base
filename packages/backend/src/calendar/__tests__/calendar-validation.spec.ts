import { BadRequestException } from '@nestjs/common';
import { normalizeCalendarEvent, validateCalendarRef } from '../calendar-validation';

describe('normalizeCalendarEvent', () => {
  it('defaults end to start + 30 minutes and the zone to the default', () => {
    expect(normalizeCalendarEvent({ title: 'Call', start: '2026-11-02T09:00:00Z' }, 'Asia/Jakarta')).toEqual({
      title: 'Call', start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T09:30:00.000Z', allDay: false, timeZone: 'Asia/Jakarta',
    });
  });

  it('keeps an explicit end, zone and the optional fields', () => {
    const out = normalizeCalendarEvent(
      { title: 'Call', start: new Date('2026-11-02T09:00:00Z'), end: '2026-11-02T10:00:00Z', timeZone: 'UTC', location: 'Room 1', description: 'd', url: 'https://app.test/x' },
      'Asia/Jakarta',
    );
    expect(out).toEqual({
      title: 'Call', start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z', allDay: false, timeZone: 'UTC',
      location: 'Room 1', description: 'd', url: 'https://app.test/x',
    });
  });

  it('keeps a meeting link', () => {
    expect(
      normalizeCalendarEvent({ title: 'Review', start: '2026-11-02T09:00:00Z', meetingUrl: 'https://meet.google.com/abc-defg-hij' }, 'UTC'),
    ).toMatchObject({ meetingUrl: 'https://meet.google.com/abc-defg-hij' });
  });

  it('all-day uses dates (in the event zone) and defaults to one day', () => {
    // 20:00 UTC on 1 Nov is already 2 Nov in Jakarta (UTC+7)
    expect(normalizeCalendarEvent({ title: 'Holiday', start: '2026-11-01T20:00:00Z', allDay: true }, 'Asia/Jakarta')).toMatchObject({
      start: '2026-11-02', end: '2026-11-03', allDay: true,
    });
    expect(normalizeCalendarEvent({ title: 'Trip', start: '2026-12-24', end: '2026-12-27', allDay: true }, 'UTC')).toMatchObject({
      start: '2026-12-24', end: '2026-12-27',
    });
  });

  it.each([
    ['end before start', { title: 'x', start: '2026-11-02T10:00:00Z', end: '2026-11-02T09:00:00Z' }],
    ['a bad date', { title: 'x', start: 'next tuesday' }],
    ['an unknown time zone', { title: 'x', start: '2026-11-02T10:00:00Z', timeZone: 'Mars/Olympus' }],
    ['an empty title', { title: '   ', start: '2026-11-02T10:00:00Z' }],
    ['a title over 1024 characters', { title: 'x'.repeat(1025), start: '2026-11-02T10:00:00Z' }],
    ['a url that is not http(s)', { title: 'x', start: '2026-11-02T10:00:00Z', url: 'javascript:alert(1)' }],
    ['a meeting link that is not https', { title: 'x', start: '2026-11-02T10:00:00Z', meetingUrl: 'http://meet.google.com/abc-defg-hij' }],
    ['a meeting link that is not a link', { title: 'x', start: '2026-11-02T10:00:00Z', meetingUrl: 'Room 1' }],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeCalendarEvent(input as any, 'UTC')).toThrow(BadRequestException);
  });
});

describe('validateCalendarRef', () => {
  const ref = { tenantSlug: 'acme', userId: 'u1', source: 'sample-plugin', key: 'article:42' };

  it('accepts a plugin key as source and a free-form key', () => {
    expect(() => validateCalendarRef(ref)).not.toThrow();
  });

  it.each([
    ['a source with capitals', { ...ref, source: 'Sample' }],
    ['a source with slashes', { ...ref, source: 'a/b' }],
    ['an empty key', { ...ref, key: '' }],
    ['a key over 200 characters', { ...ref, key: 'k'.repeat(201) }],
    ['a missing user', { ...ref, userId: '' }],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateCalendarRef(bad)).toThrow(BadRequestException);
  });
});
