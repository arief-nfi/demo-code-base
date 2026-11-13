import { isSubscriptionLive } from '../subscription-status';

const NOW = new Date('2026-10-20T12:00:00Z');

describe('isSubscriptionLive', () => {
  it.each(['ACTIVE', 'PAST_DUE'])('%s is live', (status) => {
    expect(isSubscriptionLive({ status, trialEndsAt: null }, NOW)).toBe(true);
  });

  it('TRIAL is live until trialEndsAt', () => {
    expect(isSubscriptionLive({ status: 'TRIAL', trialEndsAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(true);
    expect(isSubscriptionLive({ status: 'TRIAL', trialEndsAt: NOW }, NOW)).toBe(false);
  });

  it('TRIAL without an end date is not live', () => {
    expect(isSubscriptionLive({ status: 'TRIAL', trialEndsAt: null }, NOW)).toBe(false);
  });

  it.each(['PENDING_PAYMENT', 'PAUSED', 'ENDED', 'PENDING_APPROVAL', 'EXPIRED', 'CANCELLED', 'SUSPENDED'])(
    '%s is not live',
    (status) => {
      expect(isSubscriptionLive({ status, trialEndsAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe(false);
    },
  );

  it('no subscription is not live', () => {
    expect(isSubscriptionLive(null, NOW)).toBe(false);
  });
});
