const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const SCRIPT = resolve(__dirname, '..', 'wait-for-dev-build.js');
const { pendingProjects } = require('../wait-for-dev-build');

function makeSolution(projects) {
  const fx = mkdtempSync(join(tmpdir(), 'wait-dev-build-'));
  for (const p of projects) {
    mkdirSync(join(fx, p), { recursive: true });
    writeFileSync(join(fx, p, 'package.json'), JSON.stringify({ name: p, main: './dist/index.js', types: './dist/index.d.ts' }));
  }
  writeFileSync(join(fx, 'tsconfig.dev.json'), JSON.stringify({ files: [], references: projects.map((path) => ({ path })) }));
  return fx;
}

function markBuilt(fx, project) {
  mkdirSync(join(fx, project, 'dist'), { recursive: true });
  writeFileSync(join(fx, project, 'dist', 'index.js'), '');
  writeFileSync(join(fx, project, 'dist', 'index.d.ts'), '');
}

function writeStamp(fx) {
  mkdirSync(join(fx, '.dev-watch'), { recursive: true });
  writeFileSync(join(fx, '.dev-watch', 'api-reload.stamp'), 'x');
}

function run(fx) {
  const child = spawn(process.execPath, [
    SCRIPT, '--solution', join(fx, 'tsconfig.dev.json'), '--stamp', join(fx, '.dev-watch', 'api-reload.stamp'), '--interval', '100',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  return { child, exited, output: () => output };
}

test('pendingProjects lists projects whose main or types output is missing', () => {
  const fx = makeSolution(['a', 'b']);
  try {
    markBuilt(fx, 'a');
    // A buildinfo alone (e.g. from `tsc --noEmit`) does not count as built.
    mkdirSync(join(fx, 'b', 'dist'), { recursive: true });
    writeFileSync(join(fx, 'b', 'dist', 'tsconfig.tsbuildinfo'), '{}');
    assert.deepEqual(pendingProjects(join(fx, 'tsconfig.dev.json')), [join(fx, 'b')]);
  } finally {
    rmSync(fx, { recursive: true, force: true });
  }
});

test('exits immediately when every project is built and the stamp exists (warm start)', async () => {
  const fx = makeSolution(['a', 'b']);
  try {
    markBuilt(fx, 'a');
    markBuilt(fx, 'b');
    writeStamp(fx);
    const { exited } = run(fx);
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 3000))]);
    assert.equal(code, 0);
  } finally {
    rmSync(fx, { recursive: true, force: true });
  }
});

test('waits for every project and the first completed watcher cycle, then exits 0 (fresh clone)', async () => {
  const fx = makeSolution(['a', 'b']);
  const { child, exited, output } = run(fx);
  try {
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(child.exitCode, null, 'must still be waiting while nothing is built');
    markBuilt(fx, 'a');
    markBuilt(fx, 'b');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(child.exitCode, null, 'must still be waiting until the watcher finished its first cycle (stamp)');
    writeStamp(fx);
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 3000))]);
    assert.equal(code, 0);
    assert.match(output(), /waiting for the dev watcher/);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(fx, { recursive: true, force: true });
  }
});
