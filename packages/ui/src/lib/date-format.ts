/* ==========================================================================
   Tenant-aware formatting utilities for dates, times, numbers, and currency.
   Reads configuration from the preferences Zustand store.
   ========================================================================== */

import { usePreferencesStore } from '../stores/preferences-store';

type PreferencesKey = 'dateFormat' | 'timeFormat' | 'timezone' | 'currency' | 'numberFormat' | 'currencyFormat';

function getPreference(key: PreferencesKey): string {
  return usePreferencesStore.getState()[key];
}

// ── Date / Time helpers ──────────────────────────────────────────────────

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Convert a Date to the tenant's configured timezone and return the
 * individual date/time parts. Uses `Intl.DateTimeFormat` for reliable
 * timezone conversion.
 */
function getPartsInTimezone(date: Date, timezone: string): Record<string, number> {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      parts[p.type] = p.value;
    }

    return {
      year: parseInt(parts.year, 10),
      month: parseInt(parts.month, 10),
      day: parseInt(parts.day, 10),
      hour: parseInt(parts.hour, 10) % 24, // Intl may return 24 for midnight
      minute: parseInt(parts.minute, 10),
      second: parseInt(parts.second, 10),
    };
  } catch {
    // Fallback to UTC if timezone is invalid
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
}

function applyFormat(parts: Record<string, number>, format: string): string {
  const tokens: Record<string, string> = {
    'yyyy': parts.year.toString(),
    'YYYY': parts.year.toString(),
    'yy': parts.year.toString().slice(-2),
    'YY': parts.year.toString().slice(-2),
    'MM': pad(parts.month),
    'dd': pad(parts.day),
    'DD': pad(parts.day),
    'HH': pad(parts.hour),
    'hh': pad(parts.hour % 12 || 12),
    'mm': pad(parts.minute),
    'ss': pad(parts.second),
  };

  let result = format;
  // Replace longer tokens first to avoid partial matches
  const sortedKeys = Object.keys(tokens).sort((a, b) => b.length - a.length);
  for (const token of sortedKeys) {
    result = result.split(token).join(tokens[token]);
  }
  return result;
}

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Format a date value using the tenant's configured date format and timezone.
 * Falls back to dd/MM/yyyy and UTC.
 */
export function formatDate(value: string | Date, format?: string): string {
  const date = toDate(value);
  if (!date) return '';
  const tz = getPreference('timezone');
  const fmt = format || getPreference('dateFormat');
  return applyFormat(getPartsInTimezone(date, tz), fmt);
}

/**
 * Format a date value using the tenant's configured time format and timezone.
 * Falls back to HH:mm:ss and UTC.
 */
export function formatTime(value: string | Date, format?: string): string {
  const date = toDate(value);
  if (!date) return '';
  const tz = getPreference('timezone');
  const fmt = format || getPreference('timeFormat');
  return applyFormat(getPartsInTimezone(date, tz), fmt);
}

/**
 * Format a date value using both date and time tenant formats and timezone.
 * Falls back to dd/MM/yyyy HH:mm:ss and UTC.
 */
export function formatDateTime(value: string | Date, dateFormat?: string, timeFormat?: string): string {
  const date = toDate(value);
  if (!date) return '';
  const tz = getPreference('timezone');
  const parts = getPartsInTimezone(date, tz);
  const df = dateFormat || getPreference('dateFormat');
  const tf = timeFormat || getPreference('timeFormat');
  return `${applyFormat(parts, df)} ${applyFormat(parts, tf)}`;
}

// ── Number formatting ────────────────────────────────────────────────────

/**
 * Determine thousands and decimal separators from the stored format string.
 * Supported patterns:
 *   "1,000.00"  → thousands: ","  decimal: "."  (US / default)
 *   "1.000,00"  → thousands: "."  decimal: ","  (ID / EU)
 *   "1 000,00"  → thousands: " "  decimal: ","
 *   "1000.00"   → thousands: ""   decimal: "."
 */
function parseSeparators(format: string): { thousands: string; decimal: string; decimals: number } {
  // Find the last non-digit character — that's the decimal separator
  const cleaned = format.replace(/[0-9]/g, '');
  if (cleaned.length === 0) {
    return { thousands: '', decimal: '.', decimals: 0 };
  }

  const decimal = cleaned[cleaned.length - 1];
  const thousands = cleaned.length > 1 ? cleaned[0] : '';
  // Count digits after the last separator to determine decimal places
  const afterDecimal = format.split(decimal).pop() || '';
  const decimals = afterDecimal.replace(/[^0#]/g, '').length;

  return { thousands, decimal, decimals };
}

function formatWithSeparators(value: number, thousands: string, decimal: string, decimals: number): string {
  const isNegative = value < 0;
  const abs = Math.abs(value);
  const fixed = abs.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');

  // Add thousands separator
  let formatted = intPart;
  if (thousands) {
    formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  }

  if (decimals > 0 && decPart) {
    formatted += decimal + decPart;
  }

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Format a number using the tenant's configured number format.
 * Falls back to 1,000.00 (US-style).
 *
 * @example
 *   formatNumber(1234567.89)  // "1,234,567.89" (default)
 *   formatNumber(1234567.89)  // "1.234.567,89" (if numberFormat is "1.000,00")
 */
export function formatNumber(value: number, format?: string): string {
  if (value == null || isNaN(value)) return '';
  const fmt = format || getPreference('numberFormat');
  const { thousands, decimal, decimals } = parseSeparators(fmt);
  return formatWithSeparators(value, thousands, decimal, decimals);
}

// ── Currency formatting ──────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  IDR: 'Rp',
};

/**
 * Format a number as currency using the tenant's configured currency,
 * currency format, and number format.
 *
 * The currency format string uses `{value}` as a placeholder for the
 * formatted number. Examples:
 *   "$ {value}"   → "$ 1,000.00"
 *   "{value} USD"  → "1,000.00 USD"
 *   "Rp {value}"  → "Rp 1.000,00"
 *
 * If no currency format is configured, uses the currency symbol as prefix:
 *   USD → "$1,000.00"
 *   IDR → "Rp1,000.00"
 */
export function formatCurrency(value: number, options?: { currency?: string; currencyFormat?: string; numberFormat?: string }): string {
  if (value == null || isNaN(value)) return '';

  const currency = options?.currency || getPreference('currency');
  const currencyFmt = options?.currencyFormat || getPreference('currencyFormat');
  const numberFmt = options?.numberFormat || getPreference('numberFormat');

  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const { thousands, decimal, decimals } = parseSeparators(numberFmt);
  const formattedNumber = formatWithSeparators(value, thousands, decimal, decimals);

  // Replace placeholders in currency format
  if (currencyFmt && currencyFmt.includes('{value}')) {
    return currencyFmt
      .replace('{value}', formattedNumber)
      .replace('{symbol}', symbol)
      .replace('{currency}', currency);
  }

  // Default: symbol prefix
  return `${symbol}${formattedNumber}`;
}
