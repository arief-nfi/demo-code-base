import { BillingTenantListener } from './billing-tenant.listener';

describe('BillingTenantListener', () => {
  const base = { tenantSlug: 'acme', tenantId: 't1', tenantName: 'Acme', timestamp: new Date() };
  const setup = () => {
    const subscriptions = { restartGraceAfterReactivation: jest.fn(async () => 0) };
    const listener = new BillingTenantListener(subscriptions as any);
    jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    return { subscriptions, listener };
  };

  it('restarts grace periods when a tenant is reactivated', async () => {
    const { subscriptions, listener } = setup();
    await listener.onReactivated(base);
    expect(subscriptions.restartGraceAfterReactivation).toHaveBeenCalledWith('acme');
  });

  it('also when a sysadmin sets an inactive tenant back to ACTIVE', async () => {
    const { subscriptions, listener } = setup();
    await listener.onStatusChanged({ ...base, status: 'ACTIVE' });
    expect(subscriptions.restartGraceAfterReactivation).toHaveBeenCalledWith('acme');
  });

  it('not when a tenant is made inactive', async () => {
    const { subscriptions, listener } = setup();
    await listener.onStatusChanged({ ...base, status: 'INACTIVE' });
    expect(subscriptions.restartGraceAfterReactivation).not.toHaveBeenCalled();
  });

  it('logs and swallows a failure', async () => {
    const { subscriptions, listener } = setup();
    subscriptions.restartGraceAfterReactivation.mockRejectedValueOnce(new Error('db down'));
    await expect(listener.onReactivated(base)).resolves.toBeUndefined();
  });
});
