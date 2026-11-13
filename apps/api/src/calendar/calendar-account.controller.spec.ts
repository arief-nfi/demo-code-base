import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '@saas/backend';
import { CalendarAccountController } from './calendar-account.controller';

const req = { tenant: { slug: 'acme' }, user: { userId: 'u1' } } as any;
const summary = { provider: 'Google Calendar', status: 'CONNECTED', accountEmail: 'ann@gmail.test', calendarName: 'Acme', lastError: null };

function setup(provider: Record<string, unknown> | null) {
  const moduleRef = {
    get: jest.fn(() => {
      if (!provider) throw new Error('Nest could not find CALENDAR_PROVIDER');
      return provider;
    }),
  };
  return new CalendarAccountController(moduleRef as any);
}

const fakeProvider = (overrides: Record<string, unknown> = {}) => ({
  isConfigured: () => true,
  connectionOf: jest.fn(async () => summary),
  disconnect: jest.fn(async () => undefined),
  ...overrides,
});

describe('CalendarAccountController', () => {
  it("returns the caller's own connection", async () => {
    const provider = fakeProvider();

    await expect(setup(provider).mine(req)).resolves.toEqual({ connection: summary });
    expect(provider.connectionOf).toHaveBeenCalledWith('acme', 'u1');
  });

  it('has no connection without a provider or when it is not configured', async () => {
    await expect(setup(null).mine(req)).resolves.toEqual({ connection: null });
    await expect(setup(fakeProvider({ isConfigured: () => false })).mine(req)).resolves.toEqual({ connection: null });
  });

  it("disconnects the caller's own connection", async () => {
    const provider = fakeProvider();

    await expect(setup(provider).disconnect(req, { deleteCalendar: true })).resolves.toEqual({ status: 'DISCONNECTED' });
    expect(provider.disconnect).toHaveBeenCalledWith('acme', 'u1', { deleteCalendar: true });
  });

  it('needs only a signed-in user: no plugin guard, so people can leave while the plugin is unusable', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, CalendarAccountController) as unknown[];
    expect(guards).toEqual([JwtAuthGuard]);
  });
});
