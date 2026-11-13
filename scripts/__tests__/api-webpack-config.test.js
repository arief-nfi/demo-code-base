const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const webpackConfig = require('../../apps/api/webpack.config.js');
const { WatchDevBuildStamp, DEV_BUILD_STAMP } = webpackConfig;

function runAfterCompile(plugin) {
  let afterCompile;
  plugin.apply({ hooks: { afterCompile: { tap: (_name, fn) => { afterCompile = fn; } } } });
  const compilation = { fileDependencies: new Set(), contextDependencies: new Set(), missingDependencies: new Set() };
  afterCompile(compilation);
  return compilation;
}

test('watches the dev build stamp as a file dependency when it exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-webpack-'));
  const stampPath = join(dir, '.dev-watch', 'api-reload.stamp');
  mkdirSync(join(dir, '.dev-watch'));
  writeFileSync(stampPath, 'x');
  try {
    const c = runAfterCompile(new WatchDevBuildStamp({ stampPath }));
    assert.deepEqual([...c.fileDependencies], [stampPath]);
    assert.equal(c.missingDependencies.size, 0);
    assert.equal(c.contextDependencies.size, 0, 'dist folders themselves are not watched (one restart per watcher cycle)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('watches a missing stamp as a missing dependency (fresh clone)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-webpack-'));
  const stampPath = join(dir, '.dev-watch', 'api-reload.stamp');
  try {
    const c = runAfterCompile(new WatchDevBuildStamp({ stampPath }));
    assert.deepEqual([...c.missingDependencies], [stampPath]);
    assert.equal(c.fileDependencies.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps Nest options, appends the plugin and only ignores node_modules', () => {
  const p0 = { apply() {} };
  const config = webpackConfig({ entry: './src/main.ts', plugins: [p0], watchOptions: { poll: false } });
  assert.equal(config.entry, './src/main.ts');
  assert.equal(config.plugins[0], p0);
  assert.ok(config.plugins[1] instanceof WatchDevBuildStamp);
  assert.equal(config.watchOptions.poll, false);
  assert.ok(config.watchOptions.ignored.test('/r/node_modules/x/i.js'));
  assert.ok(!config.watchOptions.ignored.test('/r/apps/api/src/types/global.d.ts'), 'app source .d.ts must still be watched');
  assert.match(DEV_BUILD_STAMP, /\.dev-watch[\\/]api-reload\.stamp$/);
});
