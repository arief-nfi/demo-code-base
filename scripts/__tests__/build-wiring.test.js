const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO = resolve(__dirname, '..', '..');

test('@saas/database generates the Prisma client before compiling, so a fresh checkout builds', () => {
  // src/index.ts re-exports ../generated/client, which nothing else creates during `pnpm build`
  // (CI runs `pnpm install --frozen-lockfile && pnpm build` and nothing in between)
  const pkg = JSON.parse(readFileSync(join(REPO, 'packages/database/package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /^prisma generate && tsc$/);
});

test('pnpm bootstrap sets up a fresh clone: install, migrate, build, seed, then the tenant schemas', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const steps = (pkg.scripts.bootstrap ?? '').split('&&').map((s) => s.trim());
  // The seed loads the built packages, and it registers the system tenant that db:migrate:tenants walks
  assert.deepEqual(steps, ['pnpm install', 'pnpm db:migrate:deploy', 'pnpm build', 'pnpm db:seed', 'pnpm db:migrate:tenants']);
  // Not `setup`: `pnpm setup` is pnpm's own command (it edits the shell profile), so the script would never run
  assert.equal(pkg.scripts.setup, undefined);
});
