const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, renameSync, symlinkSync, statSync, existsSync, rmSync, utimesSync, chmodSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const REPO = resolve(__dirname, '..', '..');
const DEV_WATCH = join(REPO, 'scripts', 'dev-watch.js');
const {
  readSolutionProjects,
  touchProjectConfigs,
  createDebounce,
  resolveTsc,
  startDevWatch,
  apiOutputFingerprint,
  projectsDependingOn,
  staleProjects,
} = require('../dev-watch');

/**
 * A minimal "plugin consumes @saas/ui from source" setup: p1 imports ui through a
 * node_modules symlink, so ui/src is NOT one of p1's own input files and
 * `tsc -b --watch` does not notice ui changes by itself.
 */
function makeFixture() {
  const fx = mkdtempSync(join(tmpdir(), 'dev-watch-'));
  mkdirSync(join(fx, 'ui', 'src'), { recursive: true });
  writeFileSync(join(fx, 'ui', 'package.json'), JSON.stringify({ name: '@x/ui', main: 'src/index.ts', types: 'src/index.ts' }));
  writeFileSync(join(fx, 'ui', 'src', 'index.ts'), 'export interface Props { a: string }\n');
  mkdirSync(join(fx, 'p1', 'src'), { recursive: true });
  mkdirSync(join(fx, 'p1', 'node_modules', '@x'), { recursive: true });
  symlinkSync(join(fx, 'ui'), join(fx, 'p1', 'node_modules', '@x', 'ui'));
  writeFileSync(join(fx, 'p1', 'src', 'x.ts'), "import { Props } from '@x/ui';\nexport const v: Props = { a: 'x' };\n");
  writeFileSync(join(fx, 'p1', 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      composite: true, rootDir: './src', outDir: './dist', tsBuildInfoFile: './dist/tsconfig.tsbuildinfo',
      declaration: true, skipLibCheck: true, module: 'commonjs', target: 'ES2021',
    },
    include: ['src/**/*'],
  }, null, 2));
  writeFileSync(join(fx, 'tsconfig.dev.json'), JSON.stringify({ files: [], references: [{ path: 'p1' }] }, null, 2) + '\n');
  return fx;
}

async function waitFor(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`timed out after ${timeoutMs} ms waiting for ${what}`);
}

function startOnFixture(fx) {
  let output = '';
  const watch = startDevWatch({
    rootDir: fx,
    solutionPath: join(fx, 'tsconfig.dev.json'),
    sharedInputDirs: [join(fx, 'ui', 'src')],
    debounceMs: 200,
    tscPath: resolveTsc(REPO),
    onOutput: (chunk) => { output += chunk; },
  });
  return { watch, output: () => output };
}

const TYPE_ERROR = /p1\/src\/x\.ts.*error TS2322/;

/**
 * lib (a composite "backend") consumed by p1 and p2 through node_modules, each with an
 * api file (loaded by the API) and a web file (never loaded by the API). A type change in
 * lib makes tsc -b re-emit lib, p1 and p2 one after another within one build cycle.
 */
function makeChainFixture() {
  const fx = mkdtempSync(join(tmpdir(), 'dev-watch-chain-'));
  const composite = (extra = {}) => JSON.stringify({
    compilerOptions: {
      composite: true, rootDir: './src', outDir: './dist', tsBuildInfoFile: './dist/tsconfig.tsbuildinfo',
      declaration: true, skipLibCheck: true, module: 'commonjs', target: 'ES2021',
    },
    include: ['src/**/*'],
    ...extra,
  }, null, 2);
  mkdirSync(join(fx, 'lib', 'src'), { recursive: true });
  writeFileSync(join(fx, 'lib', 'package.json'), JSON.stringify({ name: '@x/lib', main: 'dist/index.js', types: 'dist/index.d.ts' }));
  writeFileSync(join(fx, 'lib', 'tsconfig.json'), composite());
  writeFileSync(join(fx, 'lib', 'src', 'index.ts'), "export interface Item { a: string }\nexport function make(): Item { return { a: 'x' }; }\n");
  for (const p of ['p1', 'p2']) {
    mkdirSync(join(fx, p, 'src', 'api'), { recursive: true });
    mkdirSync(join(fx, p, 'src', 'web'), { recursive: true });
    mkdirSync(join(fx, p, 'node_modules', '@x'), { recursive: true });
    symlinkSync(join(fx, 'lib'), join(fx, p, 'node_modules', '@x', 'lib'));
    writeFileSync(join(fx, p, 'tsconfig.json'), composite({ references: [{ path: '../lib' }] }));
    writeFileSync(join(fx, p, 'src', 'api', 'index.ts'), "import { make, Item } from '@x/lib';\nexport const v: Item = make();\n");
    writeFileSync(join(fx, p, 'src', 'web', 'page.ts'), "export const page = 'web';\n");
  }
  writeFileSync(join(fx, 'tsconfig.dev.json'), JSON.stringify({ files: [], references: [{ path: 'lib' }, { path: 'p1' }, { path: 'p2' }] }, null, 2) + '\n');
  return fx;
}

function startOnChain(fx) {
  let output = '';
  let reloads = 0;
  const watch = startDevWatch({
    rootDir: fx,
    solutionPath: join(fx, 'tsconfig.dev.json'),
    sharedInputDirs: [],
    debounceMs: 200,
    tscPath: resolveTsc(REPO),
    onOutput: (chunk) => { output += chunk; },
    onApiReload: () => { reloads += 1; },
  });
  const cycles = () => (output.match(/Watching for file changes/g) || []).length;
  return { watch, output: () => output, reloads: () => reloads, cycles };
}

async function waitForNextCycle(cyclesFn, from) {
  await waitFor(() => cyclesFn() > from, 30000, 'next tsc build cycle');
  await new Promise((r) => setTimeout(r, 1500)); // let any straggling emit/stamp settle
}

test('readSolutionProjects returns referenced project dirs', () => {
  const fx = makeFixture();
  assert.deepEqual(readSolutionProjects(join(fx, 'tsconfig.dev.json')), [join(fx, 'p1')]);
  rmSync(fx, { recursive: true, force: true });
});

test('touchProjectConfigs bumps tsconfig.json mtime', () => {
  const fx = makeFixture();
  const t = new Date(Date.now() + 5000);
  touchProjectConfigs([join(fx, 'p1')], t);
  assert.equal(Math.round(statSync(join(fx, 'p1', 'tsconfig.json')).mtimeMs), t.getTime());
  rmSync(fx, { recursive: true, force: true });
});

test('createDebounce collapses a burst into one call', async () => {
  let calls = 0;
  const d = createDebounce(() => { calls += 1; }, 200);
  for (let i = 0; i < 10; i += 1) {
    d.trigger();
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(calls, 1);
});

test('surfaces a type error after a shared source change (in-place write)', async () => {
  const fx = makeFixture();
  const { watch, output } = startOnFixture(fx);
  try {
    await waitFor(() => /Found 0 errors/.test(output()), 30000, 'initial clean build');
    writeFileSync(join(fx, 'ui', 'src', 'index.ts'), 'export interface Props { a: number }\n');
    await waitFor(() => TYPE_ERROR.test(output()), 30000, 'TS2322 in p1 after the ui change');
  } finally {
    await watch.stop();
    rmSync(fx, { recursive: true, force: true });
  }
});

test('surfaces a type error after an atomic save (temp file + rename)', async () => {
  const fx = makeFixture();
  const { watch, output } = startOnFixture(fx);
  try {
    await waitFor(() => /Found 0 errors/.test(output()), 30000, 'initial clean build');
    const tmp = join(fx, 'ui', 'src', '.index.ts.tmp');
    writeFileSync(tmp, 'export interface Props { a: number }\n');
    renameSync(tmp, join(fx, 'ui', 'src', 'index.ts'));
    await waitFor(() => TYPE_ERROR.test(output()), 30000, 'TS2322 in p1 after the atomic save');
  } finally {
    await watch.stop();
    rmSync(fx, { recursive: true, force: true });
  }
});

test('runs a project assets script before the first build', async () => {
  const fx = makeFixture();
  writeFileSync(join(fx, 'p1', 'package.json'), JSON.stringify({
    name: 'p1',
    scripts: { assets: "node -e \"require('fs').writeFileSync('assets-ran','1')\"" },
  }));
  const { watch } = startOnFixture(fx);
  try {
    assert.ok(existsSync(join(fx, 'p1', 'assets-ran')), 'assets script should have run synchronously before tsc starts');
  } finally {
    await watch.stop();
    rmSync(fx, { recursive: true, force: true });
  }
});

test('builds a project added to the solution while running (plugins:register during pnpm dev)', async () => {
  const fx = makeFixture();
  const { watch, output } = startOnFixture(fx);
  try {
    await waitFor(() => /Found 0 errors/.test(output()), 30000, 'initial clean build');
    // A second project appears and is added to the solution, as `pnpm plugins:register` would do.
    mkdirSync(join(fx, 'p2', 'src'), { recursive: true });
    writeFileSync(join(fx, 'p2', 'src', 'y.ts'), 'export const y = 1;\n');
    writeFileSync(join(fx, 'p2', 'tsconfig.json'), JSON.stringify({
      compilerOptions: { composite: true, rootDir: './src', outDir: './dist', tsBuildInfoFile: './dist/tsconfig.tsbuildinfo', module: 'commonjs', target: 'ES2021' },
      include: ['src/**/*'],
    }, null, 2));
    writeFileSync(join(fx, 'tsconfig.dev.json'), JSON.stringify({ files: [], references: [{ path: 'p1' }, { path: 'p2' }] }, null, 2) + '\n');
    await waitFor(() => existsSync(join(fx, 'p2', 'dist', 'y.js')), 30000, 'p2 built by the running watcher');
  } finally {
    await watch.stop();
    rmSync(fx, { recursive: true, force: true });
  }
});

test('apiOutputFingerprint ignores plugin web output and dictionaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-watch-fp-'));
  try {
    mkdirSync(join(dir, 'dist', 'api'), { recursive: true });
    mkdirSync(join(dir, 'dist', 'web'), { recursive: true });
    for (const f of ['api/index.js', 'web/page.js', 'dictionaries.js', 'permissions.js']) writeFileSync(join(dir, 'dist', f), '1');
    const before = apiOutputFingerprint([dir]);
    const later = new Date(Date.now() + 10000);
    utimesSync(join(dir, 'dist', 'web', 'page.js'), later, later);
    utimesSync(join(dir, 'dist', 'dictionaries.js'), later, later);
    assert.equal(apiOutputFingerprint([dir]), before, 'web output and dictionaries must not count');
    utimesSync(join(dir, 'dist', 'api', 'index.js'), later, later);
    assert.notEqual(apiOutputFingerprint([dir]), before, 'api output must count');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes the API reload stamp exactly once for a type change that re-emits several projects', async () => {
  const fx = makeChainFixture();
  const { watch, reloads, cycles } = startOnChain(fx);
  try {
    await waitFor(() => cycles() >= 1, 60000, 'initial build');
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(reloads(), 1, 'first build writes the stamp once');
    assert.ok(existsSync(join(fx, '.dev-watch', 'api-reload.stamp')));
    const c = cycles();
    writeFileSync(join(fx, 'lib', 'src', 'index.ts'), "export interface Item { a: string; b?: number }\nexport function make(): Item { return { a: 'x', b: 1 }; }\n");
    await waitForNextCycle(cycles, c);
    assert.equal(reloads(), 2, 'one more stamp for the whole cycle, not one per re-emitted project');
  } finally {
    await watch.stop();
    rmSync(fx, { recursive: true, force: true });
  }
});

test('does not write the API reload stamp for a web-only change', async () => {
  const fx = makeChainFixture();
  const { watch, reloads, cycles } = startOnChain(fx);
  try {
    await waitFor(() => cycles() >= 1, 60000, 'initial build');
    await new Promise((r) => setTimeout(r, 1000));
    const before = reloads();
    const c = cycles();
    writeFileSync(join(fx, 'p1', 'src', 'web', 'page.ts'), "export const page = 'web changed';\n");
    await waitForNextCycle(cycles, c);
    assert.equal(reloads(), before);
  } finally {
    await watch.stop();
    rmSync(fx, { recursive: true, force: true });
  }
});

test('a watcher setup failure does not leave tsc running', async () => {
  const fx = makeFixture();
  // The solution lives in a folder that can be traversed (file readable) but not listed,
  // so watching that folder fails synchronously with EACCES — like ENOSPC when the
  // inotify watch limit is exhausted.
  const sol = join(fx, 'sol');
  mkdirSync(sol);
  writeFileSync(join(sol, 'tsconfig.dev.json'), JSON.stringify({ files: [], references: [{ path: '../p1' }] }));
  chmodSync(sol, 0o311);
  let watch;
  try {
    assert.throws(() => {
      watch = startDevWatch({
        rootDir: fx,
        solutionPath: join(sol, 'tsconfig.dev.json'),
        sharedInputDirs: [],
        tscPath: resolveTsc(REPO),
        onOutput: () => {},
      });
    }, { code: 'EACCES' });
    await new Promise((r) => setTimeout(r, 500));
    const procs = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
    assert.ok(!procs.split('\n').some((l) => l.includes(fx)), 'no tsc may be left running for the fixture');
  } finally {
    if (watch) await watch.stop();
    chmodSync(sol, 0o755);
    rmSync(fx, { recursive: true, force: true });
  }
});

test('projectsDependingOn follows direct and workspace-transitive dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'dev-watch-deps-'));
  const pkg = (dir, name, deps) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name, dependencies: deps }));
  };
  try {
    pkg('lib', '@x/lib', { '@x/db': '*' });                 // like packages/backend -> @saas/database
    pkg('p1', '@x/p1', { '@x/ui': '*', '@x/lib': '*' });    // a plugin using ui and lib
    pkg('p2', '@x/p2', { '@x/lib': '*' });                  // a plugin without ui
    mkdirSync(join(root, 'p3'));                            // no package.json: unknown, so included
    const dirs = ['lib', 'p1', 'p2', 'p3'].map((d) => join(root, d));
    assert.deepEqual(projectsDependingOn(dirs, '@x/ui'), [join(root, 'p1'), join(root, 'p3')]);
    assert.deepEqual(projectsDependingOn(dirs, '@x/db'), dirs, 'p1/p2 depend on @x/db through @x/lib');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a shared input change re-checks only the projects that depend on its package', async () => {
  const fx = makeFixture();
  // p1 imports @x/ui; p2 does not depend on it at all.
  writeFileSync(join(fx, 'p1', 'package.json'), JSON.stringify({ name: '@x/p1', dependencies: { '@x/ui': '*' } }));
  mkdirSync(join(fx, 'p2', 'src'), { recursive: true });
  writeFileSync(join(fx, 'p2', 'package.json'), JSON.stringify({ name: '@x/p2', dependencies: {} }));
  writeFileSync(join(fx, 'p2', 'src', 'y.ts'), 'export const y = 1;\n');
  writeFileSync(join(fx, 'p2', 'tsconfig.json'), readFileSync(join(fx, 'p1', 'tsconfig.json'), 'utf8'));
  writeFileSync(join(fx, 'tsconfig.dev.json'), JSON.stringify({ files: [], references: [{ path: 'p1' }, { path: 'p2' }] }, null, 2) + '\n');
  let output = '';
  const watch = startDevWatch({
    rootDir: fx,
    solutionPath: join(fx, 'tsconfig.dev.json'),
    sharedInputDirs: [{ dir: join(fx, 'ui', 'src'), pkg: '@x/ui' }],
    debounceMs: 200,
    tscPath: resolveTsc(REPO),
    onOutput: (chunk) => { output += chunk; },
  });
  try {
    await waitFor(() => /Found 0 errors/.test(output), 30000, 'initial clean build');
    const p1Before = statSync(join(fx, 'p1', 'tsconfig.json')).mtimeMs;
    const p2Before = statSync(join(fx, 'p2', 'tsconfig.json')).mtimeMs;
    writeFileSync(join(fx, 'ui', 'src', 'index.ts'), 'export interface Props { a: number }\n');
    await waitFor(() => TYPE_ERROR.test(output), 30000, 'TS2322 in p1 after the ui change');
    assert.ok(statSync(join(fx, 'p1', 'tsconfig.json')).mtimeMs > p1Before, 'p1 depends on @x/ui: touched');
    assert.equal(statSync(join(fx, 'p2', 'tsconfig.json')).mtimeMs, p2Before, 'p2 does not depend on @x/ui: not touched');
  } finally {
    await watch.stop();
    rmSync(fx, { recursive: true, force: true });
  }
});

test('staleProjects finds dependents built before the newest shared input change', () => {
  const root = mkdtempSync(join(tmpdir(), 'dev-watch-stale-'));
  try {
    const built = new Date(Date.now() - 60000);
    for (const [p, deps] of [['p1', { '@x/ui': '*' }], ['p2', {}]]) {
      mkdirSync(join(root, p, 'dist'), { recursive: true });
      writeFileSync(join(root, p, 'package.json'), JSON.stringify({ name: `@x/${p}`, dependencies: deps }));
      writeFileSync(join(root, p, 'dist', 'tsconfig.tsbuildinfo'), '{}');
      utimesSync(join(root, p, 'dist', 'tsconfig.tsbuildinfo'), built, built);
    }
    mkdirSync(join(root, 'p3'));                      // never built: tsc builds it anyway
    mkdirSync(join(root, 'ui', 'src', 'nested'), { recursive: true });
    writeFileSync(join(root, 'ui', 'src', 'nested', 'a.ts'), 'x');
    const dirs = ['p1', 'p2', 'p3'].map((d) => join(root, d));
    const inputs = [{ dir: join(root, 'ui', 'src'), pkg: '@x/ui' }];
    assert.deepEqual(staleProjects(dirs, inputs), [join(root, 'p1')], 'ui changed after p1 was built; p2 does not use ui');
    const older = new Date(Date.now() - 120000);
    utimesSync(join(root, 'ui', 'src', 'nested', 'a.ts'), older, older);
    assert.deepEqual(staleProjects(dirs, inputs), [], 'ui unchanged since the last build');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a restart re-checks projects after a shared change made while the watcher was stopped', async () => {
  const fx = makeFixture();
  const first = startOnFixture(fx);
  await waitFor(() => /Found 0 errors/.test(first.output()), 30000, 'initial clean build');
  await first.watch.stop();
  // pnpm dev is stopped; @saas/ui changes (or `pnpm db:generate` runs) in the meantime
  writeFileSync(join(fx, 'ui', 'src', 'index.ts'), 'export interface Props { a: number }\n');
  const second = startOnFixture(fx);
  try {
    await waitFor(() => TYPE_ERROR.test(second.output()), 30000, 'TS2322 reported by the restarted watcher');
  } finally {
    await second.watch.stop();
    rmSync(fx, { recursive: true, force: true });
  }
});

test('stop() leaves no tsc process behind', async () => {
  const fx = makeFixture();
  const { watch, output } = startOnFixture(fx);
  await waitFor(() => /Watching for file changes/.test(output()), 30000, 'watch mode');
  const { pid } = watch.child;
  await watch.stop();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  rmSync(fx, { recursive: true, force: true });
});

test('CLI exits on SIGTERM without orphaning tsc', async () => {
  const fx = makeFixture();
  const cli = spawn(process.execPath, [
    DEV_WATCH, '--root', fx, '--solution', join(fx, 'tsconfig.dev.json'), '--shared', join(fx, 'ui', 'src'),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  cli.stdout.on('data', (c) => { output += c; });
  cli.stderr.on('data', (c) => { output += c; });
  const exited = new Promise((r) => cli.on('exit', (code) => r(code)));
  try {
    await waitFor(() => /Watching for file changes/.test(output), 30000, 'CLI watch mode');
    cli.kill('SIGTERM');
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
    assert.equal(code, 0);
    const procs = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
    assert.ok(!procs.split('\n').some((l) => l.includes(fx)), 'no process may still reference the fixture');
  } finally {
    if (cli.exitCode === null) cli.kill('SIGKILL');
    rmSync(fx, { recursive: true, force: true });
  }
});
