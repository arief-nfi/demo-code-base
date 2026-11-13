import { prorateDown, signedSum } from './money';

/** A paid invoice's period: what its unused part is worth when a plan is replaced. */
export interface PaidPeriod {
  /** Pre-tax amount of the invoice. */
  subtotal: string;
  periodStart: Date;
  periodEnd: Date;
  complimentary: boolean;
}

/**
 * Value of the paid time still ahead at `now`: for each paid period that hasn't
 * ended (a renewal paid early adds a whole period), its share of time left,
 * rounded down; complimentary periods are worth nothing.
 */
export function unusedValue(periods: PaidPeriod[], currency: string, now: Date): string {
  const shares = periods
    .filter((p) => !p.complimentary && new Date(p.periodEnd) > now)
    .map((p) => {
      const start = new Date(p.periodStart).getTime();
      const end = new Date(p.periodEnd).getTime();
      return prorateDown(p.subtotal, currency, end - Math.max(now.getTime(), start), end - start);
    });
  return signedSum(shares, currency);
}
