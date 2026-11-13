import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { Invoice } from '@saas/database';
import type { CallbackHeaders, PaymentProvider, ProviderCallback } from './payment-provider';

const STATUSES = ['PAID', 'EXPIRED', 'FAILED'] as const;

function header(headers: CallbackHeaders, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function tokensEqual(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Test-mode provider: the "hosted payment page" is the web app's /pay/<checkoutId>,
 * where you choose the outcome. Its callbacks use Xendit's invoice-callback shape
 * and x-callback-token header, so the real callback path is exercised.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly key = 'fake' as const;

  constructor(
    private readonly frontendUrl: string,
    private readonly callbackToken: string = randomBytes(24).toString('hex'),
  ) {}

  async createCheckout(input: { checkoutId: string; invoice: Invoice; expiresAt: Date }): Promise<{ externalId: string; url: string }> {
    return {
      externalId: `fake_${input.checkoutId}`,
      url: `${this.frontendUrl.replace(/\/$/, '')}/pay/${input.checkoutId}`,
    };
  }

  parseCallback(headers: CallbackHeaders, body: unknown): ProviderCallback {
    if (!tokensEqual(header(headers, 'x-callback-token'), this.callbackToken)) {
      throw new UnauthorizedException('Invalid callback token');
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const status = String(b.status ?? '') as ProviderCallback['status'];
    if (typeof b.external_id !== 'string' || !STATUSES.includes(status) || (typeof b.amount !== 'number' && typeof b.amount !== 'string')) {
      throw new BadRequestException('Malformed callback');
    }
    return {
      externalId: b.external_id,
      status,
      amount: String(b.amount),
      paidAt: typeof b.paid_at === 'string' ? new Date(b.paid_at) : undefined,
      method: typeof b.payment_method === 'string' ? b.payment_method : undefined,
      reference: typeof b.id === 'string' ? b.id : undefined,
    };
  }

  /** What the fake payment page "sends": a Xendit-shaped callback for this checkout. */
  buildCallback(input: { externalId: string; amount: string; outcome: ProviderCallback['status']; at: Date }): {
    headers: CallbackHeaders;
    body: Record<string, unknown>;
  } {
    return {
      headers: { 'x-callback-token': this.callbackToken },
      body: {
        id: `fakepay_${randomBytes(6).toString('hex')}`,
        external_id: input.externalId,
        status: input.outcome,
        amount: input.amount,
        ...(input.outcome === 'PAID'
          ? { paid_at: input.at.toISOString(), payment_method: 'BANK_TRANSFER', payment_channel: 'FAKE_VA' }
          : {}),
      },
    };
  }
}
