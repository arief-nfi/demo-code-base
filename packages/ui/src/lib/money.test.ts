import { describe, it, expect } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('IDR: Rp, dot thousands, no decimals', () => {
    expect(formatMoney(150000, 'IDR')).toBe('Rp 150.000');
    expect(formatMoney('166500.00', 'IDR')).toBe('Rp 166.500');
    expect(formatMoney(0, 'IDR')).toBe('Rp 0');
  });

  it('USD: $, comma thousands, 2 decimals', () => {
    expect(formatMoney(12, 'USD')).toBe('$12.00');
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney('1500000.00', 'USD')).toBe('$1,500,000.00');
  });

  it('unknown currency: code prefix, 2 decimals', () => {
    expect(formatMoney(5, 'EUR')).toBe('EUR 5.00');
  });
});
