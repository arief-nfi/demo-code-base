import { replacementFor } from './replacement';

const own = (over: Partial<Parameters<typeof replacementFor>[0]> = {}) => ({
  status: 'ACTIVE', pricingModel: 'MONTHLY', currency: 'IDR', currentPeriodEnd: new Date('2026-12-01'), cancelAtPeriodEnd: false, ...over,
});

describe('replacementFor', () => {
  it('active recurring in the app currency ends with credit (cancel scheduled too)', () => {
    expect(replacementFor(own(), 'IDR')).toBe('end-with-credit');
    expect(replacementFor(own({ cancelAtPeriodEnd: true, pricingModel: 'YEARLY' }), 'IDR')).toBe('end-with-credit');
  });

  it('active recurring in another currency stops renewing, unless it already won\'t', () => {
    expect(replacementFor(own({ currency: 'USD' }), 'IDR')).toBe('stop-renewing');
    expect(replacementFor(own({ currency: 'USD', cancelAtPeriodEnd: true }), 'IDR')).toBeNull();
  });

  it('an owned one-time purchase is kept', () => {
    expect(replacementFor(own({ pricingModel: 'ONE_TIME', currentPeriodEnd: null }), 'IDR')).toBe('keep-owned');
  });

  it('a free plan has nothing to replace', () => {
    expect(replacementFor(own({ pricingModel: 'FREE', currentPeriodEnd: null }), 'IDR')).toBeNull();
  });

  it.each(['TRIAL', 'PENDING_PAYMENT', 'PAST_DUE', 'PAUSED'])('%s ends', (status) => {
    expect(replacementFor(own({ status }), 'IDR')).toBe('end');
  });

  it.each(['ENDED', 'EXPIRED', 'CANCELLED', 'SUSPENDED', 'PENDING_APPROVAL'])('%s is left alone', (status) => {
    expect(replacementFor(own({ status }), 'IDR')).toBeNull();
  });
});
