/** What happens to a tenant's own plugin subscription when an app that includes the plugin is paid for. */
export type ReplacementAction = 'end-with-credit' | 'stop-renewing' | 'keep-owned' | 'end';

const ENDS = ['TRIAL', 'PENDING_PAYMENT', 'PAST_DUE', 'PAUSED'];

/**
 * - active and recurring in the app's currency → ends, its unused time becomes credit;
 * - active and recurring in another currency → stops renewing (no credit across currencies);
 * - an owned one-time purchase → kept;
 * - trial, unpaid, past due, paused → ends (nothing paid for the time ahead);
 * - free, ended, legacy → nothing to do (null).
 */
export function replacementFor(
  own: { status: string; pricingModel: string; currency: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean },
  appCurrency: string,
): ReplacementAction | null {
  if (own.status === 'ACTIVE') {
    if (own.pricingModel === 'FREE') return null;
    if (own.pricingModel === 'ONE_TIME' && !own.currentPeriodEnd) return 'keep-owned';
    if (own.currency === appCurrency) return 'end-with-credit';
    return own.cancelAtPeriodEnd ? null : 'stop-renewing';
  }
  return ENDS.includes(own.status) ? 'end' : null;
}
