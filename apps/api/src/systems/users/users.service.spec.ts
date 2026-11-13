import { SystemEvents } from '@saas/backend';
import { UsersService } from './users.service';

const alice = { id: 'u1', username: 'alice', email: 'alice@acme.test', name: 'Alice', status: 'ACTIVE', roles: [] };
const bob = { id: 'u2', username: 'bob', email: 'bob@acme.test', name: 'Bob', status: 'ACTIVE', roles: [] };

function setup(opts: { deleteFails?: boolean } = {}) {
  const users = new Map([[alice.id, { ...alice }], [bob.id, { ...bob }]]);
  const user = {
    findFirst: jest.fn(async () => null),
    // Prisma returns fresh objects, never the stored row itself
    findUnique: jest.fn(async ({ where }: any) => (users.has(where.id) ? { ...users.get(where.id)! } : null)),
    findMany: jest.fn(async ({ where }: any) => [...users.values()].filter((u) => where.id.in.includes(u.id))),
    update: jest.fn(async ({ where, data }: any) => ({ ...Object.assign(users.get(where.id)!, data) })),
    delete: jest.fn(async ({ where }: any) => {
      if (opts.deleteFails) throw new Error('db down');
      const row = users.get(where.id);
      users.delete(where.id);
      return row;
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const ids = where.id.in.filter((id: string) => users.has(id));
      ids.forEach((id: string) => users.delete(id));
      return { count: ids.length };
    }),
  };
  const prisma = { getTenantClient: jest.fn(() => ({ user })) };
  const config = { get: jest.fn((_k: string, d: unknown) => d) };
  const events = { emit: jest.fn() };
  const service = new UsersService(prisma as any, config as any, events as any);
  return { service, events };
}

const emitted = (events: { emit: jest.Mock }, name: string) => events.emit.mock.calls.filter(([event]) => event === name).map(([, payload]) => payload);

describe('UsersService events', () => {
  it("remove emits USER_DELETED with the user's id, username and email", async () => {
    const { service, events } = setup();

    await service.remove('acme', 'u1');

    expect(emitted(events, SystemEvents.USER_DELETED)).toEqual([
      expect.objectContaining({ tenantSlug: 'acme', userId: 'u1', username: 'alice', email: 'alice@acme.test', timestamp: expect.any(Date) }),
    ]);
  });

  it('removeMany emits USER_DELETED once per deleted user', async () => {
    const { service, events } = setup();

    await service.removeMany('acme', ['u1', 'u2', 'missing']);

    expect(emitted(events, SystemEvents.USER_DELETED).map((p) => p.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('a failed delete emits nothing', async () => {
    const { service, events } = setup({ deleteFails: true });

    await expect(service.remove('acme', 'u1')).rejects.toThrow('db down');

    expect(emitted(events, SystemEvents.USER_DELETED)).toEqual([]);
  });

  it('update emits USER_STATUS_CHANGED with previous and new status when status changes', async () => {
    const { service, events } = setup();

    await service.update('acme', 'u1', { status: 'INACTIVE' } as any);

    expect(emitted(events, SystemEvents.USER_STATUS_CHANGED)).toEqual([
      expect.objectContaining({ tenantSlug: 'acme', userId: 'u1', status: 'INACTIVE', previousStatus: 'ACTIVE' }),
    ]);
    expect(emitted(events, SystemEvents.USER_UPDATED)).toHaveLength(1);
  });

  it('update without a status change emits only USER_UPDATED', async () => {
    const { service, events } = setup();

    await service.update('acme', 'u1', { name: 'Alice B' } as any);
    await service.update('acme', 'u2', { status: 'ACTIVE' } as any);

    expect(emitted(events, SystemEvents.USER_STATUS_CHANGED)).toEqual([]);
    expect(emitted(events, SystemEvents.USER_UPDATED)).toHaveLength(2);
  });
});
