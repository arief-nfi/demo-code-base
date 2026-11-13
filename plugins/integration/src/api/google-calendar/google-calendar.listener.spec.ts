import { GoogleCalendarListener } from './google-calendar.listener';

function setup(offboard = jest.fn(async () => undefined)) {
  const connections = { offboard, offboardTenant: jest.fn(async () => undefined), forgetTenant: jest.fn(async () => undefined) };
  const listener = new GoogleCalendarListener(connections as any);
  const warn = jest.spyOn((listener as any).logger, 'warn').mockImplementation(() => undefined);
  return { listener, connections, warn };
}

const base = { tenantSlug: 'acme', timestamp: new Date() };

describe('GoogleCalendarListener', () => {
  it('USER_DELETED → offboard', async () => {
    const { listener, connections } = setup();

    await listener.onUserDeleted({ ...base, userId: 'u1', username: 'ann', email: 'ann@acme.test' });

    expect(connections.offboard).toHaveBeenCalledWith('acme', 'u1');
  });

  it('USER_STATUS_CHANGED to INACTIVE → offboard; to ACTIVE → nothing', async () => {
    const { listener, connections } = setup();

    await listener.onUserStatusChanged({ ...base, userId: 'u1', status: 'INACTIVE', previousStatus: 'ACTIVE' });
    await listener.onUserStatusChanged({ ...base, userId: 'u2', status: 'ACTIVE', previousStatus: 'INACTIVE' });

    expect(connections.offboard).toHaveBeenCalledTimes(1);
    expect(connections.offboard).toHaveBeenCalledWith('acme', 'u1');
  });

  it('TENANT_DELETING offboards the whole tenant; TENANT_DELETED forgets its account-index rows', async () => {
    const { listener, connections } = setup();

    const tenant = { ...base, tenantId: 't1', tenantName: 'Acme' };
    await listener.onTenantDeleting(tenant);
    await listener.onTenantDeleted(tenant);

    expect(connections.offboardTenant).toHaveBeenCalledWith('acme');
    expect(connections.forgetTenant).toHaveBeenCalledWith('acme');
  });

  it('a failed offboarding is logged, not thrown', async () => {
    const { listener, warn } = setup(jest.fn(async () => { throw new Error('db down'); }));

    await expect(listener.onUserDeleted({ ...base, userId: 'u1', username: 'ann', email: 'a@b.test' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('u1'));
  });
});
