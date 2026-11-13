import { resolveProvider } from './resolve-provider';
import { FakePaymentProvider } from './fake.provider';

const logger = () => ({ error: jest.fn(), log: jest.fn() });
const BASE = { FRONTEND_URL: 'http://localhost:3000', BILLING_CALLBACK_TOKEN: 'secret' };

describe('resolveProvider', () => {
  it('unset → no provider (paid plugins unavailable)', () => {
    expect(resolveProvider({ ...BASE }, logger())).toBeNull();
    expect(resolveProvider({ ...BASE, BILLING_PROVIDER: '' }, logger())).toBeNull();
  });

  it('fake in development → the fake provider', () => {
    const provider = resolveProvider({ ...BASE, BILLING_PROVIDER: 'fake', NODE_ENV: 'development' }, logger());
    expect(provider).toBeInstanceOf(FakePaymentProvider);
    expect(provider?.key).toBe('fake');
  });

  it('fake with NODE_ENV=production → refused, logged as an error', () => {
    const log = logger();
    expect(resolveProvider({ ...BASE, BILLING_PROVIDER: 'fake', NODE_ENV: 'production' }, log)).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('BILLING_FAKE_ALLOWED'));
  });

  it('fake with NODE_ENV=production and BILLING_FAKE_ALLOWED=true → the fake provider (staging)', () => {
    expect(
      resolveProvider({ ...BASE, BILLING_PROVIDER: 'fake', NODE_ENV: 'production', BILLING_FAKE_ALLOWED: 'true' }, logger()),
    ).toBeInstanceOf(FakePaymentProvider);
  });

  it('xendit → not implemented yet, no provider', () => {
    const log = logger();
    expect(resolveProvider({ ...BASE, BILLING_PROVIDER: 'xendit' }, log)).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not implemented'));
  });

  it('unknown → no provider, logged', () => {
    const log = logger();
    expect(resolveProvider({ ...BASE, BILLING_PROVIDER: 'stripe' }, log)).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
});

describe('FakePaymentProvider', () => {
  const provider = new FakePaymentProvider('http://localhost:3000', 'secret');

  it('checkout url points at the web app fake page', async () => {
    const out = await provider.createCheckout({ checkoutId: 'c-1', invoice: {} as any, expiresAt: new Date() });
    expect(out).toEqual({ externalId: 'fake_c-1', url: 'http://localhost:3000/pay/c-1' });
  });

  it('parseCallback rejects a missing or wrong token', () => {
    const body = { id: 'x', external_id: 'fake_c-1', status: 'PAID', amount: 10 };
    expect(() => provider.parseCallback({}, body)).toThrow('Invalid callback token');
    expect(() => provider.parseCallback({ 'x-callback-token': 'nope' }, body)).toThrow('Invalid callback token');
  });

  it('parseCallback maps a Xendit-style body', () => {
    const cb = provider.parseCallback(
      { 'x-callback-token': 'secret' },
      { id: 'fakepay_1', external_id: 'fake_c-1', status: 'PAID', amount: 166500, paid_at: '2026-10-20T10:00:00.000Z', payment_method: 'BANK_TRANSFER', payment_channel: 'FAKE_VA' },
    );
    expect(cb).toEqual({
      externalId: 'fake_c-1', status: 'PAID', amount: '166500', paidAt: new Date('2026-10-20T10:00:00.000Z'), method: 'BANK_TRANSFER', reference: 'fakepay_1',
    });
  });

  it('parseCallback rejects a malformed body', () => {
    expect(() => provider.parseCallback({ 'x-callback-token': 'secret' }, { status: 'PAID' })).toThrow();
    expect(() => provider.parseCallback({ 'x-callback-token': 'secret' }, { external_id: 'x', status: 'WEIRD', amount: 1 })).toThrow();
  });
});
