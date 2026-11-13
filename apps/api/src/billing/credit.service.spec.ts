import { CreditService } from './credit.service';
import { createBillingDb, type BillingDb } from './testing/in-memory-billing-db';

describe('CreditService', () => {
  let db: BillingDb;
  let credits: CreditService;

  beforeEach(() => {
    db = createBillingDb();
    credits = new CreditService(db as any);
  });

  const use = (amount: string, invoiceId: string, currency = 'IDR', tenantId = 't1') =>
    db.$transaction((tx) => credits.recordUse(tx as any, { tenantId, currency, amount, invoiceId }));

  it('balance sums grants, uses and restores per tenant and currency', async () => {
    await credits.grant({ tenantId: 't1', currency: 'IDR', amount: '150000', reason: 'Unused time', sourceKey: 'inventory' });
    await credits.grant({ tenantId: 't2', currency: 'IDR', amount: '90000', reason: 'Unused time', sourceKey: 'inventory' });
    await use('50000', 'inv-1');

    await expect(credits.balance('t1', 'IDR')).resolves.toBe('100000');
    await expect(credits.balance('t1', 'USD')).resolves.toBe('0.00');
    await expect(credits.balance('t2', 'IDR')).resolves.toBe('90000');
    await expect(credits.balances('t1')).resolves.toEqual([{ currency: 'IDR', amount: '100000' }]);
    expect(db.billingCredit.rows.find((r) => r.kind === 'USE')).toMatchObject({ amount: '-50000', invoiceId: 'inv-1' });
  });

  it('lockAndBalance takes the advisory lock for the tenant and currency', async () => {
    const executeRaw = jest.fn(async () => 0);
    await db.$transaction((tx) => credits.lockAndBalance({ ...tx, $executeRaw: executeRaw } as any, 't1', 'IDR'));
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect((executeRaw.mock.calls[0] as unknown[]).slice(1)).toEqual(['billing-credit:t1:IDR']);
  });

  it('restoreForInvoices gives credit back once', async () => {
    await credits.grant({ tenantId: 't1', currency: 'IDR', amount: '150000', reason: 'Unused time', sourceKey: 'inventory' });
    await use('50000', 'inv-1');
    db.invoice.rows.push({ id: 'inv-1', status: 'VOID' }, { id: 'inv-2', status: 'VOID' });

    await credits.restoreForInvoices(['inv-1', 'inv-2']);
    await credits.restoreForInvoices(['inv-1']);

    expect(db.billingCredit.rows.filter((r) => r.kind === 'RESTORE')).toEqual([
      expect.objectContaining({ tenantId: 't1', currency: 'IDR', amount: '50000', invoiceId: 'inv-1' }),
    ]);
    await expect(credits.balance('t1', 'IDR')).resolves.toBe('150000');
  });

  it('restoreForInvoices gives nothing back for an invoice that was paid instead of voided', async () => {
    await credits.grant({ tenantId: 't1', currency: 'IDR', amount: '150000', reason: 'Unused time', sourceKey: 'inventory' });
    await use('50000', 'inv-1');
    // Paid in the instant between reading the open invoices and voiding them
    db.invoice.rows.push({ id: 'inv-1', status: 'PAID' });

    await credits.restoreForInvoices(['inv-1']);

    expect(db.billingCredit.rows.filter((r) => r.kind === 'RESTORE')).toEqual([]);
    await expect(credits.balance('t1', 'IDR')).resolves.toBe('100000');
  });

  it('grant of 0 writes nothing', async () => {
    await credits.grant({ tenantId: 't1', currency: 'IDR', amount: '0', reason: 'Unused time', sourceKey: 'inventory' });
    await credits.grant({ tenantId: 't1', currency: 'USD', amount: '0.00', reason: 'Unused time', sourceKey: 'inventory' });
    expect(db.billingCredit.rows).toHaveLength(0);
  });

  it('unusedTime values the paid time still ahead of a plugin subscription', async () => {
    const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
    db.invoice.rows.push(
      { id: 'a', tenantId: 't1', pluginKey: 'inventory', status: 'PAID', complimentary: false, periodStart: d('2026-11-01'), periodEnd: d('2026-12-01'), subtotal: '150000' },
      { id: 'b', tenantId: 't1', pluginKey: 'inventory', status: 'VOID', complimentary: false, periodStart: d('2026-12-01'), periodEnd: d('2027-01-01'), subtotal: '150000' },
      { id: 'c', tenantId: 't2', pluginKey: 'inventory', status: 'PAID', complimentary: false, periodStart: d('2026-11-01'), periodEnd: d('2026-12-01'), subtotal: '150000' },
    );
    await expect(credits.unusedTime('t1', 'inventory', 'IDR', d('2026-11-16'))).resolves.toBe('75000');
  });

  it('unusedTime ignores paid time from before `since` (an earlier subscription)', async () => {
    const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
    db.invoice.rows.push(
      { id: 'old', tenantId: 't1', pluginKey: 'inventory', status: 'PAID', complimentary: false, periodStart: d('2026-11-01'), periodEnd: d('2027-11-01'), subtotal: '1800000' },
      { id: 'new', tenantId: 't1', pluginKey: 'inventory', status: 'PAID', complimentary: false, periodStart: d('2026-11-10'), periodEnd: d('2026-12-10'), subtotal: '150000' },
    );
    await expect(credits.unusedTime('t1', 'inventory', 'IDR', d('2026-11-25'), d('2026-11-10'))).resolves.toBe('75000');
  });
});
