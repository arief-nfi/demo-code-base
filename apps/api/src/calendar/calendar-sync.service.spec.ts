import { BadRequestException } from '@nestjs/common';
import { CalendarSyncService } from './calendar-sync.service';

const event = { tenantSlug: 'acme', userId: 'u1', source: 'sample-plugin', key: 'article:42', title: 'Published', start: '2026-11-02T09:00:00Z' };
const ref = { tenantSlug: 'acme', userId: 'u1', source: 'sample-plugin', key: 'article:42' };

function setup(opts: {
  provider?: boolean;
  configured?: boolean;
  usable?: boolean;           // Integration plugin usable by the tenant
  enabled?: boolean;          // tenant switched calendar sync on
  connection?: 'connected' | 'paused-reconnect' | 'none';
  queueFails?: boolean;
  previousJob?: { isFailed: () => Promise<boolean>; remove: jest.Mock };
} = {}) {
  const provider = {
    pluginKey: 'integration',
    name: 'google',
    isConfigured: jest.fn(() => opts.configured ?? true),
    isEnabledFor: jest.fn(async () => opts.enabled ?? true),
    record: jest.fn(async () => opts.connection ?? 'connected'),
    apply: jest.fn(),
    pendingRefs: jest.fn(async () => [ref, { ...ref, key: 'article:43' }]),
  };
  const moduleRef = {
    get: jest.fn(() => {
      if (opts.provider === false) throw new Error('Nest could not find CALENDAR_PROVIDER');
      return provider;
    }),
  };
  const tenantClient = {
    plugin: { findUnique: jest.fn(async () => ({ key: 'integration', isEnabled: opts.usable ?? true })) },
    tenantSubscription: { findUnique: jest.fn(async () => null) },
    tenantConfig: { findFirst: jest.fn(async () => ({ timezone: 'Asia/Jakarta' })) },
  };
  const prisma = {
    plugin: { findUnique: jest.fn(async () => ({ key: 'integration', isEnabled: true, pricingModel: 'FREE' })) },
    getTenantClient: jest.fn(() => tenantClient),
  };
  const cache = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
  const queue = {
    add: jest.fn(async () => (opts.queueFails ? Promise.reject(new Error('Redis down')) : {})),
    getJob: jest.fn(async () => opts.previousJob),
  };
  const service = new CalendarSyncService(prisma as any, queue as any, moduleRef as any, cache as any);
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, provider, queue };
}

describe('CalendarSyncService', () => {
  it("not-configured without a provider or when it isn't configured, and nothing is recorded", async () => {
    const missing = setup({ provider: false });
    await expect(missing.service.upsert(event)).resolves.toEqual({ status: 'not-configured' });

    const unconfigured = setup({ configured: false });
    await expect(unconfigured.service.upsert(event)).resolves.toEqual({ status: 'not-configured' });
    expect(unconfigured.provider.record).not.toHaveBeenCalled();
  });

  it('not-connected when the user has no connection, and nothing is queued', async () => {
    const { service, queue } = setup({ connection: 'none' });

    await expect(service.upsert(event)).resolves.toEqual({ status: 'not-connected' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("disabled when the Integration plugin isn't usable, but the request is recorded", async () => {
    const { service, provider, queue } = setup({ usable: false });

    await expect(service.upsert(event)).resolves.toEqual({ status: 'disabled' });
    expect(provider.record).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('disabled when the tenant switched calendar sync off, but the request is recorded', async () => {
    const { service, provider, queue } = setup({ enabled: false });

    await expect(service.remove(ref)).resolves.toEqual({ status: 'disabled' });
    expect(provider.record).toHaveBeenCalledWith({ ...ref, op: 'remove' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('not-connected when the connection needs reconnecting, but the request is recorded', async () => {
    const { service, provider, queue } = setup({ connection: 'paused-reconnect' });

    await expect(service.upsert(event)).resolves.toEqual({ status: 'not-connected' });
    expect(provider.record).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queued: records the normalized event, then queues a job whose data is exactly { tenantSlug, userId, source, key }', async () => {
    const { service, provider, queue } = setup();

    await expect(service.upsert(event)).resolves.toEqual({ status: 'queued' });

    expect(provider.record).toHaveBeenCalledWith({
      ...ref,
      op: 'upsert',
      event: { title: 'Published', start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T09:30:00.000Z', allDay: false, timeZone: 'Asia/Jakarta' },
    });
    const [name, data] = queue.add.mock.calls[0] as unknown as [string, unknown, unknown];
    expect(name).toBe('sync-calendar-event');
    expect(data).toEqual(ref);
  });

  it("the job id is stable per event and has no ':'", async () => {
    const { service, queue } = setup();

    await service.upsert(event);
    await service.upsert({ ...event, title: 'Renamed' });

    const ids = queue.add.mock.calls.map((call) => (call as unknown as [string, unknown, { jobId: string }])[2].jobId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toContain(':');
  });

  it('a failed job kept for the same event is removed first, so BullMQ does not ignore the new one', async () => {
    const failed = { isFailed: async () => true, remove: jest.fn(async () => undefined) };
    const { service, queue } = setup({ previousJob: failed });

    await service.upsert(event);

    expect(failed.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('a waiting job for the same event is kept (the new add collapses into it)', async () => {
    const waiting = { isFailed: async () => false, remove: jest.fn() };
    const { service } = setup({ previousJob: waiting });

    await service.upsert(event);

    expect(waiting.remove).not.toHaveBeenCalled();
  });

  it('a Redis failure while queueing still returns queued (the sweep replays it)', async () => {
    const { service } = setup({ queueFails: true });
    await expect(service.upsert(event)).resolves.toEqual({ status: 'queued' });
  });

  it('invalid input is a BadRequestException before anything is recorded', async () => {
    const { service, provider } = setup();

    await expect(service.upsert({ ...event, start: 'whenever' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.remove({ ...ref, source: 'Bad/Source' })).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.record).not.toHaveBeenCalled();
  });

  it('resync queues every pending ref when the tenant can sync, none otherwise', async () => {
    const ok = setup();
    await expect(ok.service.resync('acme', 'u1')).resolves.toBe(2);
    expect(ok.provider.pendingRefs).toHaveBeenCalledWith('acme', 'u1');
    expect(ok.queue.add).toHaveBeenCalledTimes(2);

    const off = setup({ enabled: false });
    await expect(off.service.resync('acme')).resolves.toBe(0);
    expect(off.queue.add).not.toHaveBeenCalled();
  });
});
