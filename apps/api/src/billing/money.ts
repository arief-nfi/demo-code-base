/**
 * Invoice money math in integer minor units (BigInt), never floats: prices come
 * from Prisma Decimal columns as strings and go back as decimal strings.
 */

export interface TaxSettings {
  enabled: boolean;
  name: string;
  /** Percent, e.g. 11 for 11%. */
  rate: number;
}

export interface InvoiceAmounts {
  subtotal: string;
  taxName: string | null;
  taxRate: string | null;
  taxAmount: string;
  total: string;
}

/** Decimal places of a currency's minor unit: IDR has none, everything else has 2. */
export function minorDigits(currency: string): 0 | 2 {
  return currency === 'IDR' ? 0 : 2;
}

const DECIMAL = /^\d+(\.\d+)?$/;

/** Parse a non-negative decimal into units of 10^-digits, rounding half-up. */
function toScaled(value: string | number, digits: number): bigint {
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!DECIMAL.test(text)) {
    throw new Error(`Invalid amount: ${value}`);
  }
  const [int, frac = ''] = text.split('.');
  const kept = (frac + '0'.repeat(digits)).slice(0, digits);
  const next = frac.length > digits ? Number(frac[digits]) : 0;
  const scaled = BigInt(int + kept);
  return next >= 5 ? scaled + 1n : scaled;
}

function formatScaled(scaled: bigint, digits: number): string {
  if (digits === 0) return scaled.toString();
  const text = scaled.toString().padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/**
 * Subtotal, credit, tax and total for one invoice line. Credit (from the tenant's
 * balance, capped at the subtotal) comes off before tax. Tax = round-half-up of
 * (subtotal − credit) × rate / 100 in the currency's minor unit.
 */
export function computeInvoiceAmounts(
  price: string | number,
  currency: string,
  tax: TaxSettings,
  credit: string | number = '0',
): InvoiceAmounts & { creditAmount: string } {
  const digits = minorDigits(currency);
  const subtotal = toScaled(price, digits);
  const offered = toScaled(credit, digits);
  const creditApplied = offered < subtotal ? offered : subtotal;
  const taxable = subtotal - creditApplied;

  if (!tax.enabled) {
    return {
      subtotal: formatScaled(subtotal, digits),
      taxName: null,
      taxRate: null,
      taxAmount: formatScaled(0n, digits),
      creditAmount: formatScaled(creditApplied, digits),
      total: formatScaled(taxable, digits),
    };
  }

  // Rate in hundredths of a percent: 11% → 1100, 2.5% → 250.
  const rateHundredths = toScaled(tax.rate, 2);
  const taxAmount = (taxable * rateHundredths + 5000n) / 10000n;
  return {
    subtotal: formatScaled(subtotal, digits),
    taxName: tax.name,
    taxRate: formatScaled(rateHundredths, 2),
    taxAmount: formatScaled(taxAmount, digits),
    creditAmount: formatScaled(creditApplied, digits),
    total: formatScaled(taxable + taxAmount, digits),
  };
}

/** floor(amount × part / whole) in the currency's minor unit; nothing when part or whole isn't positive. */
export function prorateDown(amount: string, currency: string, part: number, whole: number): string {
  const digits = minorDigits(currency);
  if (part <= 0 || whole <= 0) return formatScaled(0n, digits);
  const scaled = toScaled(amount, digits);
  return formatScaled((scaled * BigInt(Math.round(part))) / BigInt(Math.round(whole)), digits);
}

/** Sum of signed decimal amounts (credit entries: grants positive, uses negative). */
export function signedSum(values: Array<string | { toString(): string }>, currency: string): string {
  const digits = minorDigits(currency);
  const total = values.reduce<bigint>((sum, value) => {
    const text = value.toString().trim();
    const negative = text.startsWith('-');
    const scaled = toScaled(negative ? text.slice(1) : text, digits);
    return negative ? sum - scaled : sum + scaled;
  }, 0n);
  return total < 0n ? `-${formatScaled(-total, digits)}` : formatScaled(total, digits);
}

/** Whether a non-negative decimal amount is zero in the currency's minor unit. */
export function isZero(value: string | number | { toString(): string }, currency: string): boolean {
  return toScaled(typeof value === 'number' ? value : value.toString(), minorDigits(currency)) === 0n;
}

/** Whole percent saved by paying `price` instead of `sum` (rounded down), or null when nothing is saved. */
export function savingPercent(sum: string, price: string | number, currency: string): number | null {
  const digits = minorDigits(currency);
  const whole = toScaled(sum, digits);
  const paid = toScaled(price, digits);
  if (whole <= 0n || paid >= whole) return null;
  return Number(((whole - paid) * 100n) / whole);
}

/** A decimal amount (e.g. a Prisma Decimal sum, which drops trailing zeros) in the currency's minor-unit format. */
export function formatAmount(value: string | number | { toString(): string }, currency: string): string {
  const digits = minorDigits(currency);
  return formatScaled(toScaled(typeof value === 'number' ? value : value.toString(), digits), digits);
}

/** For people (emails): IDR `Rp 150.000`, USD `$12.00`, others `EUR 5.00` — same as the web's formatMoney. */
export function displayMoney(value: string | number | { toString(): string }, currency: string): string {
  const [int, frac] = formatAmount(value, currency).split('.');
  if (currency === 'IDR') return `Rp ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
  const grouped = `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
  return currency === 'USD' ? `$${grouped}` : `${currency} ${grouped}`;
}
