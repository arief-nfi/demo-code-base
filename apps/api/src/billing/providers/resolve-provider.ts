import type { Logger } from '@nestjs/common';
import { FakePaymentProvider } from './fake.provider';
import type { PaymentProvider } from './payment-provider';

export interface BillingProviderEnv {
  BILLING_PROVIDER?: string;
  BILLING_FAKE_ALLOWED?: string;
  NODE_ENV?: string;
  FRONTEND_URL?: string;
  BILLING_CALLBACK_TOKEN?: string;
}

/**
 * The checkout provider configured by env, or null (paid plugins unavailable).
 * BILLING_PROVIDER has no default. The fake provider never runs on a production
 * build unless BILLING_FAKE_ALLOWED=true (a staging box), so a real deploy can't
 * take fake payments.
 */
export function resolveProvider(env: BillingProviderEnv, logger: Pick<Logger, 'error' | 'log'>): PaymentProvider | null {
  const key = (env.BILLING_PROVIDER ?? '').trim();
  if (!key) return null;

  if (key === 'fake') {
    if (env.NODE_ENV === 'production' && env.BILLING_FAKE_ALLOWED !== 'true') {
      logger.error(
        'BILLING_PROVIDER=fake is refused when NODE_ENV=production (set BILLING_FAKE_ALLOWED=true only on a staging box). Paid plugins are unavailable.',
      );
      return null;
    }
    logger.log('Billing provider: fake (TEST MODE — no real money moves)');
    return new FakePaymentProvider(env.FRONTEND_URL || 'http://localhost:3000', env.BILLING_CALLBACK_TOKEN || undefined);
  }

  if (key === 'xendit') {
    logger.error('BILLING_PROVIDER=xendit is not implemented yet. Paid plugins are unavailable.');
    return null;
  }

  logger.error(`Unknown BILLING_PROVIDER "${key}". Paid plugins are unavailable.`);
  return null;
}
