const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { loadRootPublicEnv } = require('../../apps/web/load-root-env');

const REPO = resolve(__dirname, '..', '..');

function rootWith(content) {
  const dir = mkdtempSync(join(tmpdir(), 'root-env-'));
  if (content !== undefined) writeFileSync(join(dir, '.env'), content);
  return dir;
}

test("the web app takes NEXT_PUBLIC_* values from the repo-root .env", () => {
  const dir = rootWith('# web\nNEXT_PUBLIC_API_URL="https://api.example.com"   # where the API is\nNEXT_PUBLIC_FEATURE=on\n');
  const env = {};
  try {
    assert.deepEqual(loadRootPublicEnv(dir, env), ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_FEATURE']);
    assert.deepEqual(env, { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_FEATURE: 'on' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a value already set (shell, apps/web/.env.local) wins over the root .env', () => {
  const dir = rootWith('NEXT_PUBLIC_API_URL=https://from-root.example.com\n');
  const env = { NEXT_PUBLIC_API_URL: 'http://localhost:4001' };
  try {
    assert.deepEqual(loadRootPublicEnv(dir, env), []);
    assert.equal(env.NEXT_PUBLIC_API_URL, 'http://localhost:4001');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the API's secrets in the root .env never reach the web process", () => {
  const dir = rootWith('JWT_SECRET=s3cret\nSMTP_PASS=pw\nGOOGLE_CLIENT_SECRET=g\nNEXT_PUBLIC_API_URL=http://localhost:3001\n');
  const env = {};
  try {
    loadRootPublicEnv(dir, env);
    assert.deepEqual(Object.keys(env), ['NEXT_PUBLIC_API_URL']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no root .env (Docker build, fresh clone) changes nothing', () => {
  const dir = rootWith(undefined);
  const env = {};
  try {
    assert.deepEqual(loadRootPublicEnv(dir, env), []);
    assert.deepEqual(env, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('next.config.js loads the root .env before it reads NEXT_PUBLIC_API_URL', () => {
  const config = readFileSync(join(REPO, 'apps/web/next.config.js'), 'utf8');
  const load = config.indexOf('loadRootPublicEnv(');
  assert.ok(load !== -1, 'next.config.js calls loadRootPublicEnv');
  assert.ok(load < config.indexOf('process.env.NEXT_PUBLIC_API_URL'), 'before the first read of NEXT_PUBLIC_API_URL');
});
