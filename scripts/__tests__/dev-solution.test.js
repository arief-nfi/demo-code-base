const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const { generateDevSolutionContent, validatePluginTsconfig } = require('../generate-registry');
const { generateTsConfig, generatePackageJson } = require('../generate-plugin');

const REPO = resolve(__dirname, '..', '..');

function pluginDirWith(tsconfig) {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-tsconfig-'));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  return dir;
}

test('solution lists backend first then plugins sorted', () => {
  assert.equal(
    generateDevSolutionContent([{ dirName: 'zeta' }, { dirName: 'alpha' }]),
    JSON.stringify({ files: [], references: [{ path: 'packages/backend' }, { path: 'plugins/alpha' }, { path: 'plugins/zeta' }] }, null, 2) + '\n',
  );
});

test('matches the committed tsconfig.dev.json', () => {
  const plugins = readdirSync(join(REPO, 'plugins'))
    .filter((d) => existsSync(join(REPO, 'plugins', d, 'package.json')))
    .map((dirName) => ({ dirName }));
  assert.equal(generateDevSolutionContent(plugins), readFileSync(join(REPO, 'tsconfig.dev.json'), 'utf8'));
});

test('generated plugin tsconfig passes validation', () => {
  const dir = pluginDirWith(generateTsConfig());
  try {
    assert.deepEqual(validatePluginTsconfig(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every existing plugin tsconfig passes validation', () => {
  for (const d of readdirSync(join(REPO, 'plugins'))) {
    if (!existsSync(join(REPO, 'plugins', d, 'tsconfig.json'))) continue;
    assert.deepEqual(validatePluginTsconfig(join(REPO, 'plugins', d)), [], d);
  }
});

test('rejects a plugin tsconfig without composite', () => {
  const tsconfig = generateTsConfig();
  delete tsconfig.compilerOptions.composite;
  const dir = pluginDirWith(tsconfig);
  try {
    const errors = validatePluginTsconfig(dir);
    assert.ok(errors.some((e) => /composite/.test(e)), errors.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a plugin tsconfig without the backend reference', () => {
  const tsconfig = generateTsConfig();
  delete tsconfig.references;
  const dir = pluginDirWith(tsconfig);
  try {
    const errors = validatePluginTsconfig(dir);
    assert.ok(errors.some((e) => /packages\/backend/.test(e)), errors.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generated plugin package.json has no dev script', () => {
  const pkg = generatePackageJson('billing', 'Billing', 'desc', { name: 'a', email: 'a@b.c', url: 'https://x.y' });
  assert.equal(pkg.scripts.dev, undefined);
  assert.equal(pkg.scripts.build, 'tsc');
});
