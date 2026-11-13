import { BadRequestException } from '@nestjs/common';
import { MeetingService } from './meeting.service';

const input = { tenantSlug: 'acme', hostUserId: 'u1', source: 'sample-plugin', key: 'article-review:42', title: 'Review: Hello' };
const ref = { tenantSlug: 'acme', source: 'sample-plugin', key: 'article-review:42' };
const meeting = { provider: 'google-meet', joinUrl: 'https://meet.google.com/abc-defg-hij', hostUserId: 'u1', access: 'TRUSTED', status: 'ACTIVE' };

function setup(opts: { provider?: boolean; configured?: boolean; usable?: boolean; meetOn?: boolean } = {}) {
  const provider = {
    pluginKey: 'integration',
    name: 'google',
    isConfigured: jest.fn(() => opts.configured ?? true),
    isEnabledFor: jest.fn(async () => opts.meetOn ?? true),
    create: jest.fn(async (): Promise<any> => ({ status: 'created', meeting })),
    get: jest.fn(async () => meeting),
    cancel: jest.fn(async () => ({ status: 'cancelled', locked: true })),
    retryPendingLocks: jest.fn(async () => 2),
  };
  const moduleRef = {
    get: jest.fn(() => {
      if (opts.provider === false) throw new Error('Nest could not find MEETING_PROVIDER');
      return provider;
    }),
  };
  const tenantClient = {
    plugin: { findUnique: jest.fn(async () => ({ key: 'integration', isEnabled: opts.usable ?? true })) },
    tenantSubscription: { findUnique: jest.fn(async () => null) },
  };
  const prisma = {
    plugin: { findUnique: jest.fn(async () => ({ key: 'integration', isEnabled: true, pricingModel: 'FREE' })) },
    getTenantClient: jest.fn(() => tenantClient),
  };
  const cache = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
  const service = new MeetingService(prisma as any, moduleRef as any, cache as any);
  return { service, provider };
}

describe('MeetingService', () => {
  afterEach(() => jest.useRealTimers());

  it("not-configured without a provider or when it isn't configured", async () => {
    await expect(setup({ provider: false }).service.create(input)).resolves.toEqual({ status: 'not-configured' });
    const unconfigured = setup({ configured: false });
    await expect(unconfigured.service.create(input)).resolves.toEqual({ status: 'not-configured' });
    expect(unconfigured.provider.create).not.toHaveBeenCalled();
  });

  it("disabled when Integration isn't usable or the tenant switched Meet off, and the provider isn't called", async () => {
    for (const opts of [{ usable: false }, { meetOn: false }]) {
      const { service, provider } = setup(opts);
      await expect(service.create(input)).resolves.toEqual({ status: 'disabled' });
      expect(provider.create).not.toHaveBeenCalled();
    }
  });

  it('cancel answers within 10 s while Google is slow: cancelled, not locked yet', async () => {
    jest.useFakeTimers();
    const { service, provider } = setup();
    provider.cancel.mockReturnValueOnce(new Promise(() => undefined));

    const answer = service.cancel(ref);
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(answer).resolves.toEqual({ status: 'cancelled', locked: false });
  });

  it("passes the provider's result through (created, needs-permission, failed)", async () => {
    const { service, provider } = setup();
    await expect(service.create(input)).resolves.toEqual({ status: 'created', meeting });
    expect(provider.create).toHaveBeenCalledWith(input);

    provider.create.mockResolvedValueOnce({ status: 'needs-permission' });
    await expect(service.create(input)).resolves.toEqual({ status: 'needs-permission' });
    provider.create.mockResolvedValueOnce({ status: 'failed', message: 'Google said no' });
    await expect(service.create(input)).resolves.toEqual({ status: 'failed', message: 'Google said no' });
  });

  it('a provider slower than 10 s gives unavailable', async () => {
    jest.useFakeTimers();
    const { service, provider } = setup();
    provider.create.mockImplementationOnce(() => new Promise(() => undefined));

    const result = service.create(input);
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({ status: 'unavailable', message: 'Google took too long; try again.' });
  });

  it('invalid input is a BadRequestException before the provider is called', async () => {
    const { service, provider } = setup();
    await expect(service.create({ ...input, source: 'Bad/Source' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.cancel({ ...ref, key: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.create).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled();
  });

  it('get and cancel skip the tenant check and work while Meet is switched off', async () => {
    const { service, provider } = setup({ meetOn: false, usable: false });
    await expect(service.get(ref)).resolves.toEqual(meeting);
    await expect(service.cancel(ref)).resolves.toEqual({ status: 'cancelled', locked: true });
    expect(provider.get).toHaveBeenCalledWith(ref);
    expect(provider.cancel).toHaveBeenCalledWith(ref);
  });

  it('without Google credentials, get and cancel still reach the provider: meetings stay visible and can be closed', async () => {
    const { service, provider } = setup({ configured: false });
    await expect(service.get(ref)).resolves.toEqual(meeting);
    await expect(service.cancel(ref)).resolves.toEqual({ status: 'cancelled', locked: true });
    expect(provider.get).toHaveBeenCalledWith(ref);
    expect(provider.cancel).toHaveBeenCalledWith(ref);
  });

  it('without a provider: get is null and cancel is not-found', async () => {
    const { service } = setup({ provider: false });
    await expect(service.get(ref)).resolves.toBeNull();
    await expect(service.cancel(ref)).resolves.toEqual({ status: 'not-found', locked: false });
  });

  it('retryPendingLocks delegates to a configured provider, 0 otherwise', async () => {
    await expect(setup().service.retryPendingLocks('acme')).resolves.toBe(2);
    await expect(setup({ configured: false }).service.retryPendingLocks('acme')).resolves.toBe(0);
    await expect(setup({ provider: false }).service.retryPendingLocks('acme')).resolves.toBe(0);
  });
});
