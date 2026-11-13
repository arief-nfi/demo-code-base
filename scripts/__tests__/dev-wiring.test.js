const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO = resolve(__dirname, '..', '..');

test('pnpm dev runs exactly three persistent tasks', () => {
  const dry = JSON.parse(execFileSync(join(REPO, 'node_modules/.bin/turbo'), ['run', 'dev', 'dev:watch', '--dry=json'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }));
  const persistent = dry.tasks
    .filter((t) => t.command !== '<NONEXISTENT>' && t.resolvedTaskDefinition.persistent)
    .map((t) => t.taskId)
    .sort();
  assert.deepEqual(persistent, ['//#dev:watch', 'api#dev', 'web#dev']);
});

test('only apps/api and apps/web define a dev script', () => {
  const withDev = [];
  for (const group of ['apps', 'packages', 'plugins']) {
    for (const dir of readdirSync(join(REPO, group))) {
      const pkgPath = join(REPO, group, dir, 'package.json');
      if (!existsSync(pkgPath)) continue;
      if (JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.dev) withDev.push(`${group}/${dir}`);
    }
  }
  assert.deepEqual(withDev.sort(), ['apps/api', 'apps/web']);
});
