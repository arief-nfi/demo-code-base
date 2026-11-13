import { BillingPricingListener } from './billing-pricing.listener';

describe('BillingPricingListener', () => {
  const payload = { tenantSlug: 'system', pluginKey: 'docs', timestamp: new Date() };

  it('applies the pricing change of the updated plugin', async () => {
    const subscriptions = { applyPricingChange: jest.fn(async () => undefined) };
    await new BillingPricingListener(subscriptions as any).onPricingUpdated(payload);
    expect(subscriptions.applyPricingChange).toHaveBeenCalledWith('docs');
  });

  it('logs and swallows a failure (an event handler must not throw)', async () => {
    const subscriptions = { applyPricingChange: jest.fn(async () => { throw new Error('db down'); }) };
    const listener = new BillingPricingListener(subscriptions as any);
    jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    await expect(listener.onPricingUpdated(payload)).resolves.toBeUndefined();
  });

  it('applies an app pricing change to its app:<key> subscriptions', async () => {
    const subscriptions = { applyPricingChange: jest.fn(async () => undefined) };
    const listener = new BillingPricingListener(subscriptions as any);
    await listener.onAppPricingUpdated({ tenantSlug: 'system', appKey: 'warehouse', pluginKeys: [], timestamp: new Date() });
    expect(subscriptions.applyPricingChange).toHaveBeenCalledWith('app:warehouse');
  });
});
