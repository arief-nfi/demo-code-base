import { BadRequestException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { FakePaymentProvider } from './providers/fake.provider';
import { createBillingDb, type BillingDb } from './testing/in-memory-billing-db';

const NOW = new Date('2026-10-20T10:00:00Z');
const HOUR = 60 * 60 * 1000;

function setup(opts: { provider?: 'fake' | null } = {}) {
  const db: BillingDb = createBillingDb();
  db.tenant.rows.push({ id: 't1', slug: 'acme', name: 'Acme Corp' });
  db.invoice.rows.push({
    id: 'inv-1', number: 'INV-2026-0001', dedupeKey: 'k1', tenantId: 't1', tenantSlug: 'acme', pluginKey: 'docs',
    pluginName: 'Document Templates', kind: 'FIRST', pricingModel: 'MONTHLY', periodStart: null, periodEnd: null,
    currency: 'IDR', subtotal: '150000', taxAmount: '16500', total: '166500', status: 'OPEN', issuedAt: NOW,
    dueAt: new Date(NOW.getTime() + 24 * HOUR), activationError: null, sellerSnapshot: {}, billToSnapshot: {},
  });
  const provider = opts.provider === null ? null : new FakePaymentProvider('http://web.test', 'secret');
  const activator = { activateFromPayment: jest.fn(async () => undefined) };
  const settings = { getSettings: jest.fn(async () => ({ checkoutValidHours: 24 })) };
  const service = new CheckoutService(db as any, provider, activator as any, settings as any);
  return { db, provider, activator, service };
}

const paidBody = (externalId: string, amount: number | string = 166500) => ({
  id: 'xinv-1', external_id: externalId, status: 'PAID', amount, paid_at: '2026-10-20T11:00:00.000Z', payment_method: 'BANK_TRANSFER',
});
const TOKEN = { 'x-callback-token': 'secret' };

describe('CheckoutService', () => {
  it('createCheckout 503s with no provider', async () => {
    const { service } = setup({ provider: null });
    expect(service.isAvailable()).toBe(false);
    await expect(service.createCheckout('t1', 'inv-1', NOW)).rejects.toThrow(ServiceUnavailableException);
  });

  it('createCheckout creates a 24h fake checkout pointing at /pay/<id>', async () => {
    const { db, service } = setup();
    const { checkoutUrl } = await service.createCheckout('t1', 'inv-1', NOW);

    const [checkout] = db.paymentCheckout.rows;
    expect(checkoutUrl).toBe(`http://web.test/pay/${checkout.id}`);
    expect(checkout).toMatchObject({ invoiceId: 'inv-1', provider: 'fake', externalId: `fake_${checkout.id}`, status: 'PENDING' });
    expect(checkout.expiresAt).toEqual(new Date(NOW.getTime() + 24 * HOUR));
  });

  it('createCheckout reuses an unexpired pending checkout', async () => {
    const { db, service } = setup();
    const first = await service.createCheckout('t1', 'inv-1', NOW);
    const second = await service.createCheckout('t1', 'inv-1', new Date(NOW.getTime() + HOUR));
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(db.paymentCheckout.rows).toHaveLength(1);
  });

  it("createCheckout refuses another tenant's invoice and non-OPEN invoices", async () => {
    const { db, service } = setup();
    await expect(service.createCheckout('t2', 'inv-1', NOW)).rejects.toThrow(NotFoundException);
    db.invoice.rows[0].status = 'PAID';
    await expect(service.createCheckout('t1', 'inv-1', NOW)).rejects.toThrow(BadRequestException);
  });

  it('callback with a wrong token is rejected and changes nothing', async () => {
    const { db, activator, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    const externalId = db.paymentCheckout.rows[0].externalId;

    await expect(service.handleCallback('fake', { 'x-callback-token': 'wrong' }, paidBody(externalId))).rejects.toThrow(UnauthorizedException);
    expect(db.paymentCheckout.rows[0].status).toBe('PENDING');
    expect(activator.activateFromPayment).not.toHaveBeenCalled();
  });

  it('PAID callback marks the checkout paid and activates once', async () => {
    const { db, activator, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    const externalId = db.paymentCheckout.rows[0].externalId;

    await expect(service.handleCallback('fake', TOKEN, paidBody(externalId))).resolves.toEqual({ handled: true });
    expect(db.paymentCheckout.rows[0].status).toBe('PAID');
    expect(activator.activateFromPayment).toHaveBeenCalledWith('inv-1', {
      paidAt: new Date('2026-10-20T11:00:00.000Z'), provider: 'fake', method: 'BANK_TRANSFER', reference: 'xinv-1', complimentary: false,
    });
  });

  it('if activation fails, the checkout claim is released so the provider retry is processed', async () => {
    const { db, activator, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    const externalId = db.paymentCheckout.rows[0].externalId;
    activator.activateFromPayment.mockRejectedValueOnce(new Error('db down'));

    await expect(service.handleCallback('fake', TOKEN, paidBody(externalId))).rejects.toThrow('db down');
    expect(db.paymentCheckout.rows[0].status).toBe('PENDING');

    await expect(service.handleCallback('fake', TOKEN, paidBody(externalId))).resolves.toEqual({ handled: true });
    expect(activator.activateFromPayment).toHaveBeenCalledTimes(2);
    expect(db.paymentCheckout.rows[0].status).toBe('PAID');
  });

  it('a repeated PAID callback for the same checkout is a no-op', async () => {
    const { db, activator, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    const externalId = db.paymentCheckout.rows[0].externalId;

    await service.handleCallback('fake', TOKEN, paidBody(externalId));
    await expect(service.handleCallback('fake', TOKEN, paidBody(externalId))).resolves.toEqual({ handled: false });
    expect(activator.activateFromPayment).toHaveBeenCalledTimes(1);
  });

  it('PAID with an amount different from the invoice total is rejected', async () => {
    const { db, activator, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    const externalId = db.paymentCheckout.rows[0].externalId;

    await expect(service.handleCallback('fake', TOKEN, paidBody(externalId, 1000))).rejects.toThrow(BadRequestException);
    expect(db.paymentCheckout.rows[0].status).toBe('PENDING');
    expect(activator.activateFromPayment).not.toHaveBeenCalled();
  });

  it('EXPIRED/FAILED leave the invoice OPEN', async () => {
    const { db, activator, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    const externalId = db.paymentCheckout.rows[0].externalId;

    await service.handleCallback('fake', TOKEN, { ...paidBody(externalId), status: 'FAILED' });
    expect(db.paymentCheckout.rows[0].status).toBe('FAILED');
    expect(db.invoice.rows[0].status).toBe('OPEN');
    expect(activator.activateFromPayment).not.toHaveBeenCalled();
  });

  it('a PAID callback after the checkout was marked expired still counts (money moved)', async () => {
    const { db, activator, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    await service.expireStale(new Date(NOW.getTime() + 25 * HOUR));
    expect(db.paymentCheckout.rows[0].status).toBe('EXPIRED');

    await service.handleCallback('fake', TOKEN, paidBody(db.paymentCheckout.rows[0].externalId));
    expect(db.paymentCheckout.rows[0].status).toBe('PAID');
    expect(activator.activateFromPayment).toHaveBeenCalledTimes(1);
  });

  it('PAID for a VOID invoice records the checkout as paid, sets activationError "paid_after_void" and does not activate', async () => {
    const { db, activator, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    db.invoice.rows[0].status = 'VOID';

    await service.handleCallback('fake', TOKEN, paidBody(db.paymentCheckout.rows[0].externalId));
    expect(db.paymentCheckout.rows[0].status).toBe('PAID');
    expect(db.invoice.rows[0].activationError).toBe('paid_after_void');
    expect(activator.activateFromPayment).not.toHaveBeenCalled();
  });

  it('callbacks for a provider other than the active one are 404', async () => {
    const { service } = setup();
    await expect(service.handleCallback('xendit', TOKEN, {})).rejects.toThrow(NotFoundException);
  });

  it('simulateFake goes through handleCallback and returns where to send the browser', async () => {
    const { db, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    const checkoutId = db.paymentCheckout.rows[0].id;
    const spy = jest.spyOn(service, 'handleCallback');

    await expect(service.simulateFake(checkoutId, 'PAID', NOW)).resolves.toEqual({ redirectUrl: '/billing?paid=INV-2026-0001' });
    expect(spy).toHaveBeenCalledWith('fake', TOKEN, expect.objectContaining({ external_id: `fake_${checkoutId}`, status: 'PAID', amount: '166500' }));
  });

  it('simulateFake failure and expiry send the browser back with payment=failed', async () => {
    const { db, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    const checkoutId = db.paymentCheckout.rows[0].id;
    await expect(service.simulateFake(checkoutId, 'FAILED', NOW)).resolves.toEqual({ redirectUrl: '/billing?payment=failed&invoice=INV-2026-0001' });
  });

  it('simulateFake refuses an expired link', async () => {
    const { db, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    await expect(service.simulateFake(db.paymentCheckout.rows[0].id, 'PAID', new Date(NOW.getTime() + 25 * HOUR))).rejects.toThrow(BadRequestException);
  });

  it('getFakeCheckout shows what the payer pays for', async () => {
    const { db, service } = setup();
    await service.createCheckout('t1', 'inv-1', NOW);
    await expect(service.getFakeCheckout(db.paymentCheckout.rows[0].id, NOW)).resolves.toMatchObject({
      status: 'PENDING',
      invoice: { number: 'INV-2026-0001', tenantName: 'Acme Corp', pluginName: 'Document Templates', currency: 'IDR', total: '166500' },
    });
  });

  it('fake endpoints 404 when the provider is not fake', async () => {
    const { service } = setup({ provider: null });
    await expect(service.getFakeCheckout('any', NOW)).rejects.toThrow(NotFoundException);
    await expect(service.simulateFake('any', 'PAID', NOW)).rejects.toThrow(NotFoundException);
  });

  it('refuses a checkout for a fully credited invoice', async () => {
    const { service, db } = setup();
    db.invoice.rows[0].total = '0';
    await expect(service.createCheckout('t1', 'inv-1', NOW)).rejects.toThrow(/covered by your credit/);
  });
});
