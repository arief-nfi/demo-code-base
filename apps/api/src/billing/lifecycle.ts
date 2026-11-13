/**
 * Billing lifecycle decisions as pure functions of (subscription, invoice, time):
 * the services execute them under the plugin toggle lock.
 */
import { addDays, addPeriod, continuationAnchorDay } from './periods';

export type InvoiceKindName = 'FIRST' | 'RENEWAL' | 'TRIAL_CONVERSION' | 'ONE_TIME';

export interface SubSnapshot {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd: Date | null;
}

export interface SubPatch {
  status: 'ACTIVE';
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  pricingModel: string;
  pastDueAt: null;
  pausedAt: null;
  endedAt: null;
  cancelAtPeriodEnd: false;
  lastPaymentDate: Date;
}

/**
 * What a paid invoice does to its subscription. The period starts:
 * - one-time plan: now, with no end (owned);
 * - pending payment / paused / anything else: at the payment date;
 * - trial: at the trial end if paid before it, else at the payment date;
 * - active (renewal paid early): at the old period end;
 * - past due: at the old period end if paid within the grace period (the plugin
 *   stayed on meanwhile), else at the payment date (lapsed or reactivated).
 */
export function applyPayment(
  sub: SubSnapshot,
  invoice: { kind: InvoiceKindName; pricingModel: string },
  paidAt: Date,
  graceDays: number,
): { patch: SubPatch; periodStart: Date; periodEnd: Date | null } {
  let start: Date;
  let end: Date | null;

  if (invoice.pricingModel === 'ONE_TIME') {
    start = paidAt;
    end = null;
  } else {
    const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    // Continuing from the old period end keeps its billing day; a fresh start sets a new one.
    let continues = false;
    switch (sub.status) {
      case 'TRIAL':
        start = trialEnd && paidAt < trialEnd ? trialEnd : paidAt;
        break;
      case 'ACTIVE':
        continues = periodEnd != null;
        start = periodEnd ?? paidAt;
        break;
      case 'PAST_DUE':
        continues = periodEnd != null && paidAt <= addDays(periodEnd, graceDays);
        start = continues ? periodEnd! : paidAt;
        break;
      default:
        start = paidAt;
    }
    const anchorDay = continues ? continuationAnchorDay(sub.currentPeriodStart ?? null, start) : start.getUTCDate();
    end = addPeriod(start, invoice.pricingModel === 'YEARLY' ? 'YEARLY' : 'MONTHLY', anchorDay);
  }

  return {
    periodStart: start,
    periodEnd: end,
    patch: {
      status: 'ACTIVE',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      pricingModel: invoice.pricingModel,
      pastDueAt: null,
      pausedAt: null,
      endedAt: null,
      cancelAtPeriodEnd: false,
      lastPaymentDate: paidAt,
    },
  };
}

export type JobAction =
  | { type: 'ISSUE_INVOICE'; kind: 'RENEWAL' | 'TRIAL_CONVERSION'; anchor: Date; periodStart: Date | null; dueAt: Date }
  | { type: 'MARK_PAST_DUE' }
  | { type: 'PAUSE' }
  | { type: 'END' };

export interface PlanSub {
  status: string;
  pricingModel: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pastDueAt: Date | null;
}

export interface PlanContext {
  now: Date;
  renewalLeadDays: number;
  graceDays: number;
  /** The plugin is paid now (a plugin made free is never billed). */
  pluginIsPaid: boolean;
  /** The subscription's open invoice, if any. */
  openInvoice: { kind: string } | null;
}

/**
 * What the hourly job must do to one subscription now. Idempotent by design:
 * invoices are deduplicated by InvoiceService, and every transition moves the
 * subscription out of the state that triggered it.
 */
export function planSubscriptionActions(sub: PlanSub, ctx: PlanContext): JobAction[] {
  const { now } = ctx;
  const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;

  if (sub.status === 'ACTIVE' && periodEnd) {
    if (sub.cancelAtPeriodEnd) return now >= periodEnd ? [{ type: 'END' }] : [];
    if (!ctx.pluginIsPaid) return [];

    const actions: JobAction[] = [];
    if (!ctx.openInvoice && now >= addDays(periodEnd, -ctx.renewalLeadDays)) {
      actions.push({ type: 'ISSUE_INVOICE', kind: 'RENEWAL', anchor: periodEnd, periodStart: periodEnd, dueAt: periodEnd });
    }
    if (now >= periodEnd) actions.push({ type: 'MARK_PAST_DUE' });
    return actions;
  }

  if (sub.status === 'TRIAL' && trialEnd) {
    if (sub.cancelAtPeriodEnd) return now >= trialEnd ? [{ type: 'END' }] : [];
    if (!ctx.pluginIsPaid) return [];
    const actions: JobAction[] = [];
    // Issue before pausing, so a trial is never paused with nothing to pay
    if (!ctx.openInvoice && now >= addDays(trialEnd, -ctx.renewalLeadDays)) {
      actions.push({ type: 'ISSUE_INVOICE', kind: 'TRIAL_CONVERSION', anchor: trialEnd, periodStart: trialEnd, dueAt: trialEnd });
    }
    if (now >= trialEnd) actions.push({ type: 'PAUSE' });
    return actions;
  }

  if (sub.status === 'PAST_DUE' && ctx.pluginIsPaid) {
    const since = sub.pastDueAt ? new Date(sub.pastDueAt) : periodEnd;
    return since && now >= addDays(since, ctx.graceDays) ? [{ type: 'PAUSE' }] : [];
  }

  return [];
}

/**
 * Bring a subscription from before billing (manual approval era) into the
 * lifecycle, or null when it is already fine.
 */
export function normalizeLegacy(
  sub: { status: string; pricingModel: string; startDate: Date; endDate: Date | null; currentPeriodEnd: Date | null },
  now: Date,
): { patch: Record<string, unknown>; issueFirst: boolean; issueLapsedRenewal: boolean } | null {
  if (sub.status === 'PENDING_APPROVAL') {
    return { patch: { status: 'PENDING_PAYMENT' }, issueFirst: true, issueLapsedRenewal: false };
  }
  if (sub.status === 'EXPIRED' || sub.status === 'CANCELLED' || sub.status === 'SUSPENDED') {
    return { patch: { status: 'ENDED', endedAt: now }, issueFirst: false, issueLapsedRenewal: false };
  }
  const recurring = sub.pricingModel === 'MONTHLY' || sub.pricingModel === 'YEARLY';
  if (sub.status === 'ACTIVE' && recurring && !sub.currentPeriodEnd) {
    const start = new Date(sub.startDate);
    const end = sub.endDate ? new Date(sub.endDate) : addPeriod(start, sub.pricingModel as 'MONTHLY' | 'YEARLY');
    if (end < now) {
      return {
        patch: { currentPeriodStart: start, currentPeriodEnd: end, status: 'PAST_DUE', pastDueAt: now },
        issueFirst: false,
        issueLapsedRenewal: true,
      };
    }
    return { patch: { currentPeriodStart: start, currentPeriodEnd: end }, issueFirst: false, issueLapsedRenewal: false };
  }
  return null;
}
