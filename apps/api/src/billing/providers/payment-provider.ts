import type { Invoice } from '@saas/database';

/** What a provider tells us after a payment attempt, normalised from its callback. */
export interface ProviderCallback {
  externalId: string;
  status: 'PAID' | 'EXPIRED' | 'FAILED';
  /** Amount the provider says was paid, as a decimal string. */
  amount: string;
  paidAt?: Date;
  method?: string;
  /** The provider's own id for the payment, kept as the payment reference. */
  reference?: string;
}

export type CallbackHeaders = Record<string, string | string[] | undefined>;

/**
 * A hosted-checkout payment provider (Xendit's Invoice API shape): we ask it for a
 * payment URL for an invoice, the customer pays there, and it calls us back.
 * Adding a provider = implement this + register it in resolve-provider.ts.
 */
export interface PaymentProvider {
  key: 'fake' | 'xendit';
  createCheckout(input: { checkoutId: string; invoice: Invoice; expiresAt: Date }): Promise<{ externalId: string; url: string }>;
  /** Verify (shared-secret header) and normalise a callback. Throws UnauthorizedException on a bad token. */
  parseCallback(headers: CallbackHeaders, body: unknown): ProviderCallback;
}

/** Injection tokens. */
export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');
export const PAYMENT_ACTIVATOR = Symbol('PAYMENT_ACTIVATOR');

export interface PaymentDetails {
  paidAt: Date;
  provider: string;
  method?: string;
  reference?: string;
  complimentary: boolean;
}

/** Turns a verified payment into an active subscription (implemented by SubscriptionsService). */
export interface PaymentActivator {
  activateFromPayment(invoiceId: string, payment: PaymentDetails): Promise<void>;
}
