import { CreditSettlementListener } from './credit-settlement.listener';

function setup(invoice: Record<string, unknown> | null) {
  const prisma = { invoice: { findUnique: jest.fn(async () => invoice) } };
  const subscriptions = { activateFromPayment: jest.fn(async () => undefined) };
  return { subscriptions, listener: new CreditSettlementListener(prisma as any, subscriptions as any) };
}

const payload = { tenantSlug: 'acme', pluginKey: 'docs', invoiceId: 'inv-1', timestamp: new Date() };

describe('CreditSettlementListener', () => {
  it('settles a zero-total open invoice with provider credit', async () => {
    const { listener, subscriptions } = setup({ id: 'inv-1', status: 'OPEN', total: '0', currency: 'IDR' });
    await listener.onIssued(payload);
    expect(subscriptions.activateFromPayment).toHaveBeenCalledWith('inv-1', expect.objectContaining({ provider: 'credit', method: 'credit', complimentary: false }));
  });

  it('ignores invoices with something to pay or not open', async () => {
    const toPay = setup({ id: 'inv-1', status: 'OPEN', total: '1000', currency: 'IDR' });
    await toPay.listener.onIssued(payload);
    expect(toPay.subscriptions.activateFromPayment).not.toHaveBeenCalled();

    const paid = setup({ id: 'inv-1', status: 'PAID', total: '0.00', currency: 'USD' });
    await paid.listener.onIssued(payload);
    expect(paid.subscriptions.activateFromPayment).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    const { listener, subscriptions } = setup({ id: 'inv-1', status: 'OPEN', total: '0', currency: 'IDR' });
    subscriptions.activateFromPayment.mockRejectedValue(new Error('boom'));
    await expect(listener.onIssued(payload)).resolves.toBeUndefined();
  });
});
