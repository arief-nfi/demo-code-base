const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Start of the next billing period: calendar months in UTC, keeping the time of
 * day, aiming for `anchorDay` (default: the start's day) clamped to the target
 * month's last day — Jan 31 → Feb 28/29, and from Feb 28 with anchor 31 → Mar 31.
 */
export function addPeriod(start: Date, model: 'MONTHLY' | 'YEARLY', anchorDay: number = start.getUTCDate()): Date {
  const months = model === 'YEARLY' ? 12 : 1;
  const monthIndex = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchorDay, lastDay),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

/**
 * The billing day to continue a period with. A period that was clamped (Jan 31 → Feb 28)
 * still carries the anchor on one of its ends, so the larger day-of-month is it. Exact for
 * monthly plans; a yearly Feb 29 anchor is lost after two non-leap years.
 */
export function continuationAnchorDay(periodStart: Date | null, periodEnd: Date): number {
  const end = new Date(periodEnd).getUTCDate();
  return periodStart ? Math.max(new Date(periodStart).getUTCDate(), end) : end;
}
