import { SystemEvents } from '@saas/backend';
import { NotificationListenerService } from './notification-listener.service';

describe('NotificationListenerService — calendar', () => {
  it('a calendar disconnect notifies that user with a link to the Google Calendar page', async () => {
    const notifications = { create: jest.fn(async () => ({})), notifyAdmins: jest.fn() };
    const ws = { broadcastToTenant: jest.fn() };
    const listener = new NotificationListenerService(notifications as any, ws as any);

    await listener.onCalendarDisconnected({ tenantSlug: 'acme', userId: 'u1', reason: 'Google access was revoked', timestamp: new Date() });

    expect(notifications.create).toHaveBeenCalledWith('acme', expect.objectContaining({
      userId: 'u1',
      type: 'WARNING',
      category: 'integration',
      link: '/plugins/integration/google-calendar',
      sourceEvent: SystemEvents.INTEGRATION_CALENDAR_DISCONNECTED,
      body: expect.stringContaining('Google access was revoked'),
    }));
    expect(notifications.notifyAdmins).not.toHaveBeenCalled();
  });

  it('the reason reads as a sentence whatever its case or final full stop', async () => {
    const notifications = { create: jest.fn(async () => ({})), notifyAdmins: jest.fn() };
    const listener = new NotificationListenerService(notifications as any, { broadcastToTenant: jest.fn() } as any);

    await listener.onCalendarDisconnected({ tenantSlug: 'acme', userId: 'u1', reason: 'the calendar was deleted.', timestamp: new Date() });

    expect(notifications.create).toHaveBeenCalledWith('acme', expect.objectContaining({
      body: 'The calendar was deleted. Reconnect your calendar to resume syncing.',
    }));
  });

  it('names what stopped working: meetings, or calendar sync and meetings; calendar wording otherwise', async () => {
    const cases: Array<[Array<'calendar' | 'meetings'> | undefined, string, string]> = [
      [['meetings'], 'Meetings stopped working', 'Google access was revoked. Reconnect your account to host meetings again.'],
      [['calendar', 'meetings'], 'Calendar sync and meetings stopped', 'Google access was revoked. Reconnect your account to resume calendar syncing and host meetings again.'],
      [['calendar'], 'Calendar sync stopped', 'Google access was revoked. Reconnect your calendar to resume syncing.'],
      [undefined, 'Calendar sync stopped', 'Google access was revoked. Reconnect your calendar to resume syncing.'],
    ];
    for (const [features, title, body] of cases) {
      const notifications = { create: jest.fn(async () => ({})), notifyAdmins: jest.fn() };
      const listener = new NotificationListenerService(notifications as any, { broadcastToTenant: jest.fn() } as any);

      await listener.onCalendarDisconnected({ tenantSlug: 'acme', userId: 'u1', reason: 'Google access was revoked', features, timestamp: new Date() });

      expect(notifications.create).toHaveBeenCalledWith('acme', expect.objectContaining({ title, body }));
    }
  });
});

describe('NotificationListenerService — subscriptions', () => {
  const subscribed = async (payload: Record<string, unknown>) => {
    const notifications = { create: jest.fn(), notifyAdmins: jest.fn(async () => []) };
    const listener = new NotificationListenerService(notifications as any, { broadcastToTenant: jest.fn() } as any);
    await listener.onPluginSubscribed({ tenantSlug: 'acme', timestamp: new Date(), ...payload } as any);
    return (notifications.notifyAdmins.mock.calls[0] as any[])[1];
  };

  it('names the app, not its product key', async () => {
    await expect(subscribed({ pluginKey: 'app:warehouse', pluginName: 'Warehouse' })).resolves.toMatchObject({
      title: 'App subscribed',
      body: 'Subscribed to app "Warehouse".',
      sourceEvent: SystemEvents.PLUGIN_SUBSCRIBED,
    });
  });

  it('names the plugin, and falls back to its key', async () => {
    await expect(subscribed({ pluginKey: 'integration', pluginName: 'Integration' })).resolves.toMatchObject({
      title: 'Plugin subscribed',
      body: 'Subscribed to plugin "Integration".',
    });
    await expect(subscribed({ pluginKey: 'integration' })).resolves.toMatchObject({ body: 'Subscribed to plugin "integration".' });
  });
});
