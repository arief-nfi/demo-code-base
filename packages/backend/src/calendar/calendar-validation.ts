import { BadRequestException } from '@nestjs/common';
import type { CalendarEventInput, CalendarRef, NormalizedCalendarEvent } from './calendar.types';

const SOURCE = /^[a-z0-9-]{1,64}$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TITLE = 1024;
const MAX_KEY = 200;
const DEFAULT_DURATION = 30 * 60_000;

const invalidEvent = (problem: string) => new BadRequestException(`Invalid calendar event: ${problem}`);

export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const invalidRef = (problem: string) => new BadRequestException(`Invalid calendar reference: ${problem}`);

export function validateCalendarRef(ref: CalendarRef): void {
  if (typeof ref.tenantSlug !== 'string' || !ref.tenantSlug) throw invalidRef('tenantSlug is required');
  if (typeof ref.userId !== 'string' || !ref.userId) throw invalidRef('userId is required');
  if (typeof ref.source !== 'string' || !SOURCE.test(ref.source)) throw invalidRef('source must be lowercase letters, digits and "-" (at most 64)');
  if (typeof ref.key !== 'string' || ref.key.length < 1 || ref.key.length > MAX_KEY) throw invalidRef(`key must be 1–${MAX_KEY} characters`);
}

function parseInstant(value: string | Date, field: string): Date {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw invalidEvent(`${field} is not a valid date`);
  return date;
}

/** The calendar date (YYYY-MM-DD) of an instant, as seen in `zone` */
function dateInZone(date: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function parseDay(value: string | Date, zone: string, field: string): string {
  const match = typeof value === 'string' ? DATE_ONLY.exec(value) : null;
  if (!match) return dateInZone(parseInstant(value, field), zone);
  const [, y, m, d] = match.map(Number);
  // Rejects dates that don't exist (2026-02-30), which Date.UTC would roll over
  if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== value) throw invalidEvent(`${field} is not a valid date`);
  return value as string;
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Validates an event and fills in its defaults. Throws BadRequestException, so a
 * caller's mistake surfaces at the call, not later in the queue.
 */
export function normalizeCalendarEvent(input: CalendarEventInput, defaultTimeZone: string): NormalizedCalendarEvent {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw invalidEvent('title is required');
  if (title.length > MAX_TITLE) throw invalidEvent(`title is longer than ${MAX_TITLE} characters`);

  const timeZone = input.timeZone ?? defaultTimeZone;
  if (!isValidTimeZone(timeZone)) throw invalidEvent(`unknown time zone "${String(timeZone)}"`);

  let start: string;
  let end: string;
  const allDay = input.allDay === true;
  if (allDay) {
    start = parseDay(input.start, timeZone, 'start');
    end = input.end === undefined ? addDays(start, 1) : parseDay(input.end, timeZone, 'end');
    // Plain string comparison orders YYYY-MM-DD dates
    if (end <= start) throw invalidEvent('end must be after start (an all-day end is the day after the last day)');
  } else {
    const startAt = parseInstant(input.start, 'start');
    const endAt = input.end === undefined ? new Date(startAt.getTime() + DEFAULT_DURATION) : parseInstant(input.end, 'end');
    if (endAt < startAt) throw invalidEvent('end is before start');
    start = startAt.toISOString();
    end = endAt.toISOString();
  }

  const event: NormalizedCalendarEvent = { title, start, end, allDay, timeZone };
  if (typeof input.location === 'string' && input.location) event.location = input.location;
  if (typeof input.description === 'string' && input.description) event.description = input.description;
  if (input.url !== undefined) {
    let url: URL | null = null;
    try {
      url = new URL(input.url);
    } catch {
      // reported below
    }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) throw invalidEvent('url must be an http(s) link');
    event.url = input.url;
  }
  if (input.meetingUrl !== undefined) {
    let meetingUrl: URL | null = null;
    try {
      meetingUrl = new URL(input.meetingUrl);
    } catch {
      // reported below
    }
    if (meetingUrl?.protocol !== 'https:') throw invalidEvent('meetingUrl must be an https link');
    event.meetingUrl = input.meetingUrl;
  }
  return event;
}
