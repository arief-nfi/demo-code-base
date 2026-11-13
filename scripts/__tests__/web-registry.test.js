const { test } = require('node:test');
const assert = require('node:assert/strict');

const { generateWebRegistryFiles } = require('../generate-registry');

const PLUGINS = [
  { dirName: 'plugin-a', pkgName: '@saas/plugin-a', pascalName: 'PluginA', hasWebMenus: true, hasDictionaries: true },
  { dirName: 'plugin-b', pkgName: '@saas/plugin-b', pascalName: 'PluginB', hasWebMenus: false, hasDictionaries: true },
];

test('menus module imports only /menus entries', () => {
  const f = generateWebRegistryFiles(PLUGINS)['plugin-menus.ts'];
  assert.match(f, /import \{ PluginAMenus \} from '@saas\/plugin-a\/menus';/);
  assert.match(f, /'plugin-a': PluginAMenus/);
  assert.doesNotMatch(f, /plugin-b/, 'plugin without menus must not appear');
  assert.doesNotMatch(f, /\/web'/);
  assert.doesNotMatch(f, /\/dictionaries'/);
  assert.match(f, /export const PluginMenus: Record<string, NavigationItem\[\]> = \{/);
});

test('dictionaries module imports only /dictionaries entries', () => {
  const f = generateWebRegistryFiles(PLUGINS)['plugin-dictionaries.ts'];
  assert.match(f, /import \{ pluginADictionaries \} from '@saas\/plugin-a\/dictionaries';/);
  assert.match(f, /import \{ pluginBDictionaries \} from '@saas\/plugin-b\/dictionaries';/);
  assert.doesNotMatch(f, /\/web'/);
  assert.doesNotMatch(f, /\/menus'/);
  assert.match(f, /export const PluginDictionaries: Dictionaries\[\] = \[/);
});

test('routes module has no static /web import and lazy-loads every plugin', () => {
  const f = generateWebRegistryFiles(PLUGINS)['plugin-routes.ts'];
  assert.doesNotMatch(f, /^import [^\n]*\/web'/m);
  assert.match(f, /'plugin-a': \(\) => import\('@saas\/plugin-a\/web'\)\.then\(\(m\) => m\.PluginARoutes\)/);
  assert.match(f, /'plugin-b': \(\) => import\('@saas\/plugin-b\/web'\)\.then\(\(m\) => m\.PluginBRoutes\)/);
  assert.match(f, /export const PluginRouteLoaders: Record<string, \(\) => Promise<Record<string, PluginComponent>>> = \{/);
});

test('no plugins yields valid empty exports', () => {
  const files = generateWebRegistryFiles([]);
  assert.match(files['plugin-menus.ts'], /export const PluginMenus: Record<string, NavigationItem\[\]> = \{\};/);
  assert.match(files['plugin-dictionaries.ts'], /export const PluginDictionaries: Dictionaries\[\] = \[\];/);
  assert.match(files['plugin-routes.ts'], /export const PluginRouteLoaders: Record<string, \(\) => Promise<Record<string, PluginComponent>>> = \{\};/);
});
