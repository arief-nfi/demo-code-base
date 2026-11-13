const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateLifecycle } = require('../generate-plugin');

test('a new plugin implements only the lifecycle hooks core calls', () => {
  const lifecycle = generateLifecycle('OrderDesk', 'order-desk');

  for (const hook of ['onInstall', 'onActivate', 'onDeactivate', 'onUpgrade', 'healthCheck', 'getDefaultConfig']) {
    assert.match(lifecycle, new RegExp(`\\b${hook}\\(`), `${hook} is scaffolded`);
  }
  // There is no uninstall in core: plugins are only enabled or disabled per tenant
  assert.doesNotMatch(lifecycle, /onUninstall|UninstallContext/);
});
