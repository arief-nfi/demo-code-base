import { computeInvoiceAmounts, displayMoney, formatAmount, isZero, minorDigits, prorateDown, signedSum } from './money';

const PPN = { enabled: true, name: 'PPN', rate: 11 };
const OFF = { enabled: false, name: 'PPN', rate: 11 };

describe('minorDigits', () => {
  it('IDR has no decimals, everything else has 2', () => {
    expect(minorDigits('IDR')).toBe(0);
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('EUR')).toBe(2);
  });
});

describe('computeInvoiceAmounts', () => {
  it('IDR 150000 with PPN 11%', () => {
    expect(computeInvoiceAmounts(150000, 'IDR', PPN)).toEqual({
      subtotal: '150000',
      taxName: 'PPN',
      taxRate: '11.00',
      taxAmount: '16500',
      creditAmount: '0',
      total: '166500',
    });
  });

  it('USD 12 with 11%', () => {
    expect(computeInvoiceAmounts('12', 'USD', PPN)).toMatchObject({ subtotal: '12.00', taxAmount: '1.32', total: '13.32' });
  });

  it('rounds tax half-up in the minor unit (USD 9.99 → 1.10)', () => {
    expect(computeInvoiceAmounts('9.99', 'USD', PPN)).toMatchObject({ subtotal: '9.99', taxAmount: '1.10', total: '11.09' });
  });

  it('rounds IDR tax to whole rupiah (99999 → 11000)', () => {
    expect(computeInvoiceAmounts(99999, 'IDR', PPN)).toMatchObject({ taxAmount: '11000', total: '110999' });
  });

  it('a Prisma Decimal-style string price works (150000.00 IDR)', () => {
    expect(computeInvoiceAmounts('150000.00', 'IDR', PPN)).toMatchObject({ subtotal: '150000', total: '166500' });
  });

  it('tax disabled: no tax line, total = subtotal', () => {
    expect(computeInvoiceAmounts(150000, 'IDR', OFF)).toEqual({
      subtotal: '150000', taxName: null, taxRate: null, taxAmount: '0', creditAmount: '0', total: '150000',
    });
    expect(computeInvoiceAmounts('12', 'USD', OFF)).toEqual({
      subtotal: '12.00', taxName: null, taxRate: null, taxAmount: '0.00', creditAmount: '0.00', total: '12.00',
    });
  });

  it('supports a fractional rate (USD 100 at 2.5% → 2.50)', () => {
    expect(computeInvoiceAmounts(100, 'USD', { enabled: true, name: 'VAT', rate: 2.5 })).toMatchObject({
      taxRate: '2.50', taxAmount: '2.50', total: '102.50',
    });
  });

  it('rejects a negative or malformed price', () => {
    expect(() => computeInvoiceAmounts(-1, 'USD', OFF)).toThrow();
    expect(() => computeInvoiceAmounts('abc', 'USD', OFF)).toThrow();
  });

  it('credit comes off before tax and is capped at the subtotal', () => {
    expect(computeInvoiceAmounts('300000', 'IDR', PPN, '50000')).toMatchObject({ subtotal: '300000', creditAmount: '50000', taxAmount: '27500', total: '277500' });
    expect(computeInvoiceAmounts('300000', 'IDR', PPN, '500000')).toMatchObject({ creditAmount: '300000', taxAmount: '0', total: '0' });
    expect(computeInvoiceAmounts('12.00', 'USD', OFF)).toMatchObject({ creditAmount: '0.00', total: '12.00' });
  });
});

describe('prorateDown', () => {
  it('rounds down per currency', () => {
    expect(prorateDown('100000', 'IDR', 10, 30)).toBe('33333');
    expect(prorateDown('10.00', 'USD', 1, 3)).toBe('3.33');
  });

  it('nothing when no time is left or the period is empty', () => {
    expect(prorateDown('100000', 'IDR', 0, 30)).toBe('0');
    expect(prorateDown('100000', 'IDR', 5, 0)).toBe('0');
  });
});

describe('signedSum / isZero', () => {
  it('signedSum handles USE entries', () => {
    expect(signedSum(['150000', '-50000', '-25000'], 'IDR')).toBe('75000');
    expect(signedSum(['1.50', '-2.00'], 'USD')).toBe('-0.50');
    expect(signedSum([], 'USD')).toBe('0.00');
  });

  it('isZero reads any decimal form', () => {
    expect(isZero('0', 'IDR')).toBe(true);
    expect(isZero('0.00', 'USD')).toBe(true);
    expect(isZero({ toString: () => '0' }, 'USD')).toBe(true);
    expect(isZero('0.01', 'USD')).toBe(false);
  });
});

describe('formatAmount', () => {
  it('pads to the currency minor unit (Prisma Decimal sums drop trailing zeros)', () => {
    expect(formatAmount('25', 'USD')).toBe('25.00');
    expect(formatAmount({ toString: () => '13.3' }, 'USD')).toBe('13.30');
    expect(formatAmount('166500', 'IDR')).toBe('166500');
    expect(formatAmount('166500.00', 'IDR')).toBe('166500');
  });
});

describe('displayMoney (emails; same format as the web formatMoney)', () => {
  it('IDR Rp 150.000, USD $1,234.50, others CODE 5.00', () => {
    expect(displayMoney('166500.00', 'IDR')).toBe('Rp 166.500');
    expect(displayMoney('1234.5', 'USD')).toBe('$1,234.50');
    expect(displayMoney({ toString: () => '5' }, 'EUR')).toBe('EUR 5.00');
  });
});
