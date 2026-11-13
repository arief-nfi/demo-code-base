import { unusedValue } from './credit';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('unusedValue', () => {
  it('half a month left of a monthly IDR plan', () => {
    expect(unusedValue([{ subtotal: '300000', periodStart: d('2026-11-01'), periodEnd: d('2026-12-01'), complimentary: false }], 'IDR', d('2026-11-16'))).toBe('150000');
  });

  it('a renewal paid early counts both periods', () => {
    expect(unusedValue([
      { subtotal: '300000', periodStart: d('2026-11-01'), periodEnd: d('2026-12-01'), complimentary: false },
      { subtotal: '300000', periodStart: d('2026-12-01'), periodEnd: d('2027-01-01'), complimentary: false },
    ], 'IDR', d('2026-11-26'))).toBe('350000');
  });

  it('complimentary and past periods give nothing', () => {
    expect(unusedValue([
      { subtotal: '300000', periodStart: d('2026-11-01'), periodEnd: d('2026-12-01'), complimentary: true },
      { subtotal: '300000', periodStart: d('2026-10-01'), periodEnd: d('2026-11-01'), complimentary: false },
    ], 'IDR', d('2026-11-16'))).toBe('0');
  });

  it('USD rounds down to the cent', () => {
    expect(unusedValue([{ subtotal: '10.00', periodStart: d('2026-11-01'), periodEnd: d('2026-12-01'), complimentary: false }], 'USD', d('2026-11-21'))).toBe('3.33');
  });
});
