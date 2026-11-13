import { addPeriod, addDays, addHours, continuationAnchorDay } from './periods';

const d = (iso: string) => new Date(iso);

describe('addPeriod (UTC, calendar months, end-of-month clamping)', () => {
  it('monthly keeps day and time of day', () => {
    expect(addPeriod(d('2026-10-20T08:30:00Z'), 'MONTHLY').toISOString()).toBe('2026-11-20T08:30:00.000Z');
  });

  it('Jan 31 + 1 month clamps to Feb 28', () => {
    expect(addPeriod(d('2026-01-31T00:00:00Z'), 'MONTHLY').toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('Jan 31 + 1 month in a leap year clamps to Feb 29', () => {
    expect(addPeriod(d('2028-01-31T10:00:00Z'), 'MONTHLY').toISOString()).toBe('2028-02-29T10:00:00.000Z');
  });

  it('Feb 29 + 1 year clamps to Feb 28', () => {
    expect(addPeriod(d('2028-02-29T00:00:00Z'), 'YEARLY').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });

  it('December rolls into the next year', () => {
    expect(addPeriod(d('2026-12-15T00:00:00Z'), 'MONTHLY').toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('does not mutate its input', () => {
    const start = d('2026-10-20T00:00:00Z');
    addPeriod(start, 'YEARLY');
    expect(start.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});

describe('addDays / addHours', () => {
  it('shift by exact durations (negative allowed)', () => {
    expect(addDays(d('2026-10-20T00:00:00Z'), -7).toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(addHours(d('2026-10-20T00:00:00Z'), 24).toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });
});

describe('month-end anchor (no drift: Jan 31 → Feb 28 → Mar 31, not Mar 28)', () => {
  it('addPeriod aims for the anchor day, clamped to the month', () => {
    expect(addPeriod(d('2026-02-28T00:00:00Z'), 'MONTHLY', 31).toISOString()).toBe('2026-03-31T00:00:00.000Z');
    expect(addPeriod(d('2026-04-30T09:00:00Z'), 'MONTHLY', 31).toISOString()).toBe('2026-05-31T09:00:00.000Z');
    expect(addPeriod(d('2026-03-31T00:00:00Z'), 'MONTHLY', 31).toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('continuationAnchorDay recovers the anchor from the previous period', () => {
    expect(continuationAnchorDay(d('2026-01-31T00:00:00Z'), d('2026-02-28T00:00:00Z'))).toBe(31);
    expect(continuationAnchorDay(d('2026-02-28T00:00:00Z'), d('2026-03-31T00:00:00Z'))).toBe(31);
    expect(continuationAnchorDay(d('2026-01-30T00:00:00Z'), d('2026-02-28T00:00:00Z'))).toBe(30);
    expect(continuationAnchorDay(d('2026-10-20T00:00:00Z'), d('2026-11-20T00:00:00Z'))).toBe(20);
    expect(continuationAnchorDay(null, d('2026-11-20T00:00:00Z'))).toBe(20);
  });
});
