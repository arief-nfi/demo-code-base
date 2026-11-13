import { appKeyOf, appRef, grantingAppRefs, isPluginGranted } from '../entitlement';

const DAY = 24 * 60 * 60 * 1000;
const live = { status: 'ACTIVE', trialEndsAt: null };

describe('entitlement', () => {
  it('appRef / appKeyOf round-trip; plugin keys are not apps', () => {
    expect(appRef('warehouse')).toBe('app:warehouse');
    expect(appKeyOf('app:warehouse')).toBe('warehouse');
    expect(appKeyOf('inventory')).toBeNull();
  });

  it('own live subscription grants', () => {
    expect(isPluginGranted('inventory', [{ pluginKey: 'inventory', ...live }])).toBe(true);
  });

  it('a live app subscription whose list contains the plugin grants it', () => {
    const subs = [{ pluginKey: 'app:warehouse', ...live, grantedPlugins: ['inventory', 'procurement'] }];
    expect(isPluginGranted('inventory', subs)).toBe(true);
    expect(grantingAppRefs('inventory', subs)).toEqual(['app:warehouse']);
    expect(isPluginGranted('reports', subs)).toBe(false);
  });

  it('paused app, expired app trial, ended own subscription do not grant', () => {
    const subs = [
      { pluginKey: 'app:warehouse', status: 'PAUSED', trialEndsAt: null, grantedPlugins: ['inventory'] },
      { pluginKey: 'app:retail', status: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY), grantedPlugins: ['inventory'] },
      { pluginKey: 'inventory', status: 'ENDED', trialEndsAt: null },
    ];
    expect(isPluginGranted('inventory', subs)).toBe(false);
  });

  it('a plugin granted by two apps is listed under both, sorted', () => {
    const subs = [
      { pluginKey: 'app:warehouse', ...live, grantedPlugins: ['inventory'] },
      { pluginKey: 'app:retail', status: 'PAST_DUE', trialEndsAt: null, grantedPlugins: ['inventory'] },
    ];
    expect(grantingAppRefs('inventory', subs)).toEqual(['app:retail', 'app:warehouse']);
  });

  it('a plugin subscription never counts as granting another plugin', () => {
    const subs = [{ pluginKey: 'docs', ...live, grantedPlugins: ['inventory'] }];
    expect(isPluginGranted('inventory', subs)).toBe(false);
  });
});
