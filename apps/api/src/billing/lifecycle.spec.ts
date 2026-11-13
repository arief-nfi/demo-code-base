import { applyPayment, normalizeLegacy, planSubscriptionActions } from './lifecycle';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const MONTHLY = { kind: 'RENEWAL' as const, pricingModel: 'MONTHLY' };
const sub = (status: string, over: { trialEndsAt?: Date | null; currentPeriodEnd?: Date | null; currentPeriodStart?: Date | null } = {}) => ({
  status,
  trialEndsAt: over.trialEndsAt ?? null,
  currentPeriodStart: over.currentPeriodStart ?? null,
  currentPeriodEnd: over.currentPeriodEnd ?? null,
});

describe('applyPayment', () => {
  it('first payment (PENDING_PAYMENT) starts the period at the payment date', () => {
    const r = applyPayment(sub('PENDING_PAYMENT'), { kind: 'FIRST', pricingModel: 'MONTHLY' }, d('2026-10-20'), 7);
    expect(r.periodStart).toEqual(d('2026-10-20'));
    expect(r.periodEnd).toEqual(d('2026-11-20'));
    expect(r.patch).toMatchObject({
      status: 'ACTIVE', currentPeriodStart: d('2026-10-20'), currentPeriodEnd: d('2026-11-20'), pricingModel: 'MONTHLY',
      pastDueAt: null, pausedAt: null, endedAt: null, cancelAtPeriodEnd: false, lastPaymentDate: d('2026-10-20'),
    });
  });

  it('a yearly plan gets a year', () => {
    const r = applyPayment(sub('PENDING_PAYMENT'), { kind: 'FIRST', pricingModel: 'YEARLY' }, d('2026-10-20'), 7);
    expect(r.periodEnd).toEqual(d('2027-10-20'));
  });

  it('one-time: ACTIVE with no end (owned)', () => {
    const r = applyPayment(sub('PENDING_PAYMENT'), { kind: 'ONE_TIME', pricingModel: 'ONE_TIME' }, d('2026-10-20'), 7);
    expect(r.periodStart).toEqual(d('2026-10-20'));
    expect(r.periodEnd).toBeNull();
    expect(r.patch).toMatchObject({ status: 'ACTIVE', currentPeriodEnd: null, pricingModel: 'ONE_TIME' });
  });

  it('a renewal paid early continues from the old period end (no gap, no overlap)', () => {
    const r = applyPayment(sub('ACTIVE', { currentPeriodEnd: d('2026-10-20') }), MONTHLY, d('2026-10-15'), 7);
    expect(r.periodStart).toEqual(d('2026-10-20'));
    expect(r.periodEnd).toEqual(d('2026-11-20'));
  });

  it('PAST_DUE paid within grace continues from the old period end', () => {
    const r = applyPayment(sub('PAST_DUE', { currentPeriodEnd: d('2026-10-20') }), MONTHLY, d('2026-10-25'), 7);
    expect(r.periodStart).toEqual(d('2026-10-20'));
  });

  it('PAST_DUE paid after the grace window starts at the payment date (lapsed / reactivated)', () => {
    const r = applyPayment(sub('PAST_DUE', { currentPeriodEnd: d('2026-10-20') }), MONTHLY, d('2026-11-02'), 7);
    expect(r.periodStart).toEqual(d('2026-11-02'));
    expect(r.periodEnd).toEqual(d('2026-12-02'));
  });

  it('PAUSED resumes with a new period from the payment date', () => {
    const r = applyPayment(sub('PAUSED', { currentPeriodEnd: d('2026-09-20') }), MONTHLY, d('2026-10-05'), 7);
    expect(r.periodStart).toEqual(d('2026-10-05'));
  });

  it('a trial conversion paid before the trial ends starts at the trial end', () => {
    const r = applyPayment(sub('TRIAL', { trialEndsAt: d('2026-10-27') }), { kind: 'TRIAL_CONVERSION', pricingModel: 'MONTHLY' }, d('2026-10-24'), 7);
    expect(r.periodStart).toEqual(d('2026-10-27'));
    expect(r.periodEnd).toEqual(d('2026-11-27'));
  });

  it('a trial conversion paid after the trial ended starts at the payment date', () => {
    const r = applyPayment(sub('TRIAL', { trialEndsAt: d('2026-10-27') }), { kind: 'TRIAL_CONVERSION', pricingModel: 'MONTHLY' }, d('2026-10-28'), 7);
    expect(r.periodStart).toEqual(d('2026-10-28'));
  });

  it('renewals keep a month-end billing day (Jan 31 → Feb 28 → Mar 31 → Apr 30 → May 31)', () => {
    let period = { start: d('2026-01-31'), end: d('2026-02-28') };
    const ends: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = applyPayment(sub('ACTIVE', { currentPeriodStart: period.start, currentPeriodEnd: period.end }), MONTHLY, period.start, 7);
      period = { start: r.periodStart, end: r.periodEnd! };
      ends.push(period.end.toISOString().slice(0, 10));
    }
    expect(ends).toEqual(['2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('PAST_DUE paid within grace also keeps the billing day', () => {
    const r = applyPayment(sub('PAST_DUE', { currentPeriodStart: d('2026-01-31'), currentPeriodEnd: d('2026-02-28') }), MONTHLY, d('2026-03-02'), 7);
    expect(r.periodEnd).toEqual(d('2026-03-31'));
  });

  it("the invoice's plan wins over the subscription's (monthly → yearly at renewal)", () => {
    const r = applyPayment(sub('ACTIVE', { currentPeriodEnd: d('2026-10-20') }), { kind: 'RENEWAL', pricingModel: 'YEARLY' }, d('2026-10-18'), 7);
    expect(r.periodEnd).toEqual(d('2027-10-20'));
    expect(r.patch.pricingModel).toBe('YEARLY');
  });
});

describe('planSubscriptionActions (lead 7, grace 7)', () => {
  const ctx = (now: string, over: Partial<{ pluginIsPaid: boolean; openInvoice: { kind: 'RENEWAL' | 'TRIAL_CONVERSION' | 'FIRST' } | null }> = {}) => ({
    now: d(now), renewalLeadDays: 7, graceDays: 7, pluginIsPaid: true, openInvoice: null, ...over,
  });
  const plan = (over: Record<string, unknown>) => ({
    status: 'ACTIVE', pricingModel: 'MONTHLY', trialEndsAt: null, currentPeriodEnd: d('2026-10-20'), cancelAtPeriodEnd: false, pastDueAt: null,
    ...over,
  });

  it('ACTIVE: nothing before the renewal window', () => {
    expect(planSubscriptionActions(plan({}), ctx('2026-10-12'))).toEqual([]);
  });

  it('ACTIVE: issues the renewal 7 days before the period end, due at the period end', () => {
    expect(planSubscriptionActions(plan({}), ctx('2026-10-13'))).toEqual([
      { type: 'ISSUE_INVOICE', kind: 'RENEWAL', anchor: d('2026-10-20'), periodStart: d('2026-10-20'), dueAt: d('2026-10-20') },
    ]);
  });

  it('ACTIVE: no second renewal while one is open', () => {
    expect(planSubscriptionActions(plan({}), ctx('2026-10-15', { openInvoice: { kind: 'RENEWAL' } }))).toEqual([]);
  });

  it('ACTIVE: unpaid at the period end → past due', () => {
    expect(planSubscriptionActions(plan({}), ctx('2026-10-20', { openInvoice: { kind: 'RENEWAL' } }))).toEqual([{ type: 'MARK_PAST_DUE' }]);
  });

  it('ACTIVE: past the period end with no invoice at all → issue and mark past due in one run', () => {
    expect(planSubscriptionActions(plan({}), ctx('2026-12-01')).map((a) => a.type)).toEqual(['ISSUE_INVOICE', 'MARK_PAST_DUE']);
  });

  it('ACTIVE cancelling: nothing before the end, END at the end, never a renewal', () => {
    expect(planSubscriptionActions(plan({ cancelAtPeriodEnd: true }), ctx('2026-10-15'))).toEqual([]);
    expect(planSubscriptionActions(plan({ cancelAtPeriodEnd: true }), ctx('2026-10-20'))).toEqual([{ type: 'END' }]);
  });

  it('TRIAL: conversion invoice 7 days before the trial ends, due at the trial end', () => {
    const trial = plan({ status: 'TRIAL', currentPeriodEnd: null, trialEndsAt: d('2026-10-27') });
    expect(planSubscriptionActions(trial, ctx('2026-10-19'))).toEqual([]);
    expect(planSubscriptionActions(trial, ctx('2026-10-20'))).toEqual([
      { type: 'ISSUE_INVOICE', kind: 'TRIAL_CONVERSION', anchor: d('2026-10-27'), periodStart: d('2026-10-27'), dueAt: d('2026-10-27') },
    ]);
  });

  it('TRIAL shorter than the lead time: the conversion invoice goes out right away', () => {
    const trial = plan({ status: 'TRIAL', currentPeriodEnd: null, trialEndsAt: d('2026-10-23') });
    expect(planSubscriptionActions(trial, ctx('2026-10-20'))[0]).toMatchObject({ type: 'ISSUE_INVOICE', kind: 'TRIAL_CONVERSION' });
  });

  it('TRIAL: unpaid at the trial end → paused, no grace', () => {
    const trial = plan({ status: 'TRIAL', currentPeriodEnd: null, trialEndsAt: d('2026-10-27') });
    expect(planSubscriptionActions(trial, ctx('2026-10-27', { openInvoice: { kind: 'TRIAL_CONVERSION' } }))).toEqual([{ type: 'PAUSE' }]);
  });

  it('TRIAL past its end with no conversion invoice yet: issue it and pause in one run (never paused with nothing to pay)', () => {
    const trial = plan({ status: 'TRIAL', currentPeriodEnd: null, trialEndsAt: d('2026-10-27') });
    expect(planSubscriptionActions(trial, ctx('2026-10-28'))).toEqual([
      { type: 'ISSUE_INVOICE', kind: 'TRIAL_CONVERSION', anchor: d('2026-10-27'), periodStart: d('2026-10-27'), dueAt: d('2026-10-27') },
      { type: 'PAUSE' },
    ]);
  });

  it('TRIAL with renewalLeadDays 0: the conversion invoice is issued when the trial ends', () => {
    const trial = plan({ status: 'TRIAL', currentPeriodEnd: null, trialEndsAt: d('2026-10-27') });
    expect(planSubscriptionActions(trial, { ...ctx('2026-10-27'), renewalLeadDays: 0 }).map((a) => a.type)).toEqual(['ISSUE_INVOICE', 'PAUSE']);
  });

  it('TRIAL cancelling: END at the trial end', () => {
    const trial = plan({ status: 'TRIAL', currentPeriodEnd: null, trialEndsAt: d('2026-10-27'), cancelAtPeriodEnd: true });
    expect(planSubscriptionActions(trial, ctx('2026-10-21'))).toEqual([]);
    expect(planSubscriptionActions(trial, ctx('2026-10-27'))).toEqual([{ type: 'END' }]);
  });

  it('PAST_DUE: paused once the grace period from pastDueAt is over', () => {
    const due = plan({ status: 'PAST_DUE', pastDueAt: d('2026-10-20') });
    expect(planSubscriptionActions(due, ctx('2026-10-26', { openInvoice: { kind: 'RENEWAL' } }))).toEqual([]);
    expect(planSubscriptionActions(due, ctx('2026-10-27', { openInvoice: { kind: 'RENEWAL' } }))).toEqual([{ type: 'PAUSE' }]);
  });

  it('planSubscriptionActions returns [] for PAUSED, ENDED, PENDING_PAYMENT and one-time ACTIVE', () => {
    const late = ctx('2027-06-01');
    expect(planSubscriptionActions(plan({ status: 'PAUSED' }), late)).toEqual([]);
    expect(planSubscriptionActions(plan({ status: 'ENDED' }), late)).toEqual([]);
    expect(planSubscriptionActions(plan({ status: 'PENDING_PAYMENT', currentPeriodEnd: null }), late)).toEqual([]);
    expect(planSubscriptionActions(plan({ pricingModel: 'ONE_TIME', currentPeriodEnd: null }), late)).toEqual([]);
  });

  it('a plugin that is free now is never billed (only a scheduled end still applies)', () => {
    const free = ctx('2026-10-25', { pluginIsPaid: false });
    expect(planSubscriptionActions(plan({}), free)).toEqual([]);
    expect(planSubscriptionActions(plan({ status: 'TRIAL', currentPeriodEnd: null, trialEndsAt: d('2026-10-21') }), free)).toEqual([]);
    expect(planSubscriptionActions(plan({ cancelAtPeriodEnd: true }), free)).toEqual([{ type: 'END' }]);
  });
});

describe('normalizeLegacy', () => {
  const NOW = d('2026-10-20');
  const legacy = (over: Record<string, unknown>) => ({
    status: 'ACTIVE', pricingModel: 'MONTHLY', startDate: d('2026-10-01'), endDate: null, currentPeriodStart: null, currentPeriodEnd: null,
    ...over,
  }) as any;

  it('PENDING_APPROVAL → PENDING_PAYMENT, issue the first invoice', () => {
    expect(normalizeLegacy(legacy({ status: 'PENDING_APPROVAL' }), NOW)).toEqual({ patch: { status: 'PENDING_PAYMENT' }, issueFirst: true, issueLapsedRenewal: false });
  });

  it.each(['EXPIRED', 'CANCELLED', 'SUSPENDED'])('%s → ENDED', (status) => {
    expect(normalizeLegacy(legacy({ status }), NOW)).toEqual({ patch: { status: 'ENDED', endedAt: NOW }, issueFirst: false, issueLapsedRenewal: false });
  });

  it('hand-approved ACTIVE gets its period from startDate..endDate', () => {
    expect(normalizeLegacy(legacy({ endDate: d('2026-11-01') }), NOW)).toEqual({
      patch: { currentPeriodStart: d('2026-10-01'), currentPeriodEnd: d('2026-11-01') }, issueFirst: false, issueLapsedRenewal: false,
    });
  });

  it('without an endDate the period is one interval from startDate', () => {
    expect(normalizeLegacy(legacy({ pricingModel: 'YEARLY' }), NOW)?.patch).toEqual({ currentPeriodStart: d('2026-10-01'), currentPeriodEnd: d('2027-10-01') });
  });

  it('a lapsed hand-approved period → past due now, one renewal invoice starting when paid', () => {
    expect(normalizeLegacy(legacy({ startDate: d('2026-01-01'), endDate: d('2026-02-01') }), NOW)).toEqual({
      patch: { currentPeriodStart: d('2026-01-01'), currentPeriodEnd: d('2026-02-01'), status: 'PAST_DUE', pastDueAt: NOW },
      issueFirst: false,
      issueLapsedRenewal: true,
    });
  });

  it('leaves current subscriptions, FREE and one-time ones alone', () => {
    expect(normalizeLegacy(legacy({ currentPeriodEnd: d('2026-11-01') }), NOW)).toBeNull();
    expect(normalizeLegacy(legacy({ pricingModel: 'FREE' }), NOW)).toBeNull();
    expect(normalizeLegacy(legacy({ pricingModel: 'ONE_TIME' }), NOW)).toBeNull();
    expect(normalizeLegacy(legacy({ status: 'PAUSED' }), NOW)).toBeNull();
  });
});
