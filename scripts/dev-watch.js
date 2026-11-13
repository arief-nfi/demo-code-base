#!/usr/bin/env node

/**
 * Dev watcher — one `tsc -b --watch` for packages/backend + every plugin.
 *
 * Replaces the per-package `tsc --watch` dev tasks (one process + one turbo slot per
 * plugin). Type errors for all projects are printed in this one stream.
 *
 * `tsc -b --watch` only watches each project's own input files, so code a plugin
 * imports from outside its folder (`@saas/ui` source, the generated Prisma client)
 * would not trigger a re-check. This script watches those shared inputs and touches
 * every project's tsconfig.json when they change, which makes tsc rebuild them.
 *
 * At the end of every build cycle it writes `.dev-watch/api-reload.stamp` when output
 * the API can load (backend + plugin dist, excluding web UI) changed. The API's webpack
 * watches only that file, so it restarts once per cycle — not once per re-emitted file,
 * and never on a half-written dist.
 *
 * Usage:
 *   node scripts/dev-watch.js [--root <dir>] [--solution <file>] [--shared <dir>]...
 * Defaults: repo root, <root>/tsconfig.dev.json, <root>/packages/ui/src and
 * <root>/packages/database/generated.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const API_RELOAD_STAMP = path.join('.dev-watch', 'api-reload.stamp');

function readSolutionProjects(solutionPath) {
  const solution = JSON.parse(fs.readFileSync(solutionPath, 'utf8'));
  const base = path.dirname(solutionPath);
  return (solution.references || []).map((ref) => path.resolve(base, ref.path));
}

function touchProjectConfigs(projectDirs, when = new Date()) {
  for (const dir of projectDirs) {
    fs.utimesSync(path.join(dir, 'tsconfig.json'), when, when);
  }
}

function createDebounce(fn, ms) {
  let timer = null;
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function runAssetScripts(projectDirs, log) {
  for (const dir of projectDirs) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const cmd = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts?.assets;
    if (!cmd) continue;
    log(`[assets] ${path.relative(process.cwd(), dir) || dir}: ${cmd}`);
    execSync(cmd, { cwd: dir, stdio: 'inherit' });
  }
}

/**
 * Projects that depend on package `pkg` — directly (package.json dependencies) or through
 * another project in the list (e.g. a plugin depends on @saas/database via @saas/backend).
 * A project without a package.json is included: unknown dependencies are re-checked.
 */
function projectsDependingOn(projectDirs, pkg) {
  const manifests = new Map();
  for (const dir of projectDirs) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    manifests.set(dir, { name: json.name, deps: Object.keys({ ...json.dependencies, ...json.devDependencies, ...json.peerDependencies }) });
  }
  const dirByName = new Map([...manifests].map(([dir, m]) => [m.name, dir]));
  const memo = new Map();
  const dependsOn = (dir, seen = new Set()) => {
    if (memo.has(dir)) return memo.get(dir);
    const m = manifests.get(dir);
    if (!m) return true;
    if (seen.has(dir)) return false;
    seen.add(dir);
    const result = m.deps.includes(pkg) || m.deps.some((d) => dirByName.has(d) && dependsOn(dirByName.get(d), seen));
    memo.set(dir, result);
    return result;
  };
  return projectDirs.filter((dir) => dependsOn(dir));
}

function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else {
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {
        // file vanished mid-walk
      }
    }
  }
  return newest;
}

/**
 * Projects whose last build (dist/tsconfig.tsbuildinfo) is older than the newest file in
 * a shared input they depend on — e.g. @saas/ui edited or `pnpm db:generate` run while
 * the watcher was stopped. A fresh `tsc -b` only compares each project's own files, so
 * these must be touched at startup to be re-checked. Never-built projects are skipped
 * (tsc builds them anyway).
 */
function staleProjects(projectDirs, sharedInputs) {
  const stale = new Set();
  for (const entry of sharedInputs) {
    const { dir, pkg } = typeof entry === 'string' ? { dir: entry } : entry;
    if (!fs.existsSync(dir)) continue;
    const newest = newestMtime(dir);
    const dependents = pkg ? projectsDependingOn(projectDirs, pkg) : projectDirs;
    for (const project of dependents) {
      const buildInfo = path.join(project, 'dist', 'tsconfig.tsbuildinfo');
      if (fs.existsSync(buildInfo) && fs.statSync(buildInfo).mtimeMs < newest) stale.add(project);
    }
  }
  return projectDirs.filter((d) => stale.has(d));
}

function resolveTsc(rootDir) {
  // Use packages/backend's TypeScript (pinned) rather than the root "typescript": "latest",
  // so the watcher emits exactly what each package's own build would.
  return require.resolve('typescript/bin/tsc', { paths: [path.join(rootDir, 'packages', 'backend')] });
}

/**
 * Fingerprint of the compiled output the API can load: every .js under each project's
 * dist except plugin web UI (`dist/web/**`) and `dist/dictionaries.js`. Any re-emit
 * bumps an mtime, so a changed fingerprint means the API should restart.
 */
function apiOutputFingerprint(projectDirs) {
  let count = 0;
  let latest = 0;
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no dist yet
    }
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (relPath !== 'web') walk(path.join(dir, entry.name), relPath);
      } else if (entry.name.endsWith('.js') && relPath !== 'dictionaries.js') {
        count += 1;
        latest = Math.max(latest, fs.statSync(path.join(dir, entry.name)).mtimeMs);
      }
    }
  };
  for (const dir of projectDirs) walk(path.join(dir, 'dist'), '');
  return `${count}:${latest}`;
}

function startDevWatch({
  rootDir,
  solutionPath,
  sharedInputDirs,
  debounceMs = 1000,
  tscPath,
  onOutput,
  onApiReload,
  pretty = false,
  apiReloadStampPath = path.join(rootDir, API_RELOAD_STAMP),
}) {
  const write = onOutput || ((chunk) => process.stdout.write(chunk));
  const log = (line) => write(`${line}\n`);
  let projectDirs = readSolutionProjects(solutionPath);

  const args = [tscPath, '-b', '--watch', '--preserveWatchOutput', ...(pretty ? ['--pretty'] : []), solutionPath];
  let child = null;
  let childExited = null;
  let restarting = false;
  let stopped = false;
  let resolveUnexpectedExit;
  // Resolves only when tsc dies on its own (not for an intentional restart or stop()).
  const exited = new Promise((r) => { resolveUnexpectedExit = r; });

  // End of a tsc build cycle: write the API reload stamp if API-loadable output changed.
  function onCycleEnd() {
    try {
      const fingerprint = apiOutputFingerprint(projectDirs);
      const previous = fs.existsSync(apiReloadStampPath) ? fs.readFileSync(apiReloadStampPath, 'utf8') : null;
      if (fingerprint === previous) return;
      fs.mkdirSync(path.dirname(apiReloadStampPath), { recursive: true });
      fs.writeFileSync(apiReloadStampPath, fingerprint);
      if (onApiReload) onApiReload(fingerprint);
    } catch (err) {
      log(`[dev-watch] could not update ${apiReloadStampPath}: ${err.message}`);
    }
  }

  function spawnTsc() {
    child = spawn(process.execPath, args, { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      write(text);
      // tsc prints "Found N errors. Watching for file changes." once per completed cycle.
      tail = (tail + text).slice(-4096);
      if (tail.includes('Watching for file changes')) {
        tail = '';
        onCycleEnd();
      }
    });
    child.stderr.on('data', (chunk) => write(chunk.toString()));
    childExited = new Promise((r) => child.on('exit', (code) => {
      if (!restarting && !stopped) resolveUnexpectedExit(code);
      r(code);
    }));
  }

  async function killTsc() {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await childExited;
      clearTimeout(killTimer);
    }
  }

  // Shared inputs: `{ dir, pkg }` re-checks only projects depending on `pkg`; a plain dir
  // (or no pkg) re-checks every project.
  const sharedInputs = sharedInputDirs.map((entry) => (typeof entry === 'string' ? { dir: entry } : entry));
  const pendingPkgs = new Set();
  let pendingAll = false;
  const recheck = createDebounce(() => {
    try {
      // Re-read the solution so plugins registered while running are covered too.
      const projects = readSolutionProjects(solutionPath).filter((d) => fs.existsSync(path.join(d, 'tsconfig.json')));
      const targets = pendingAll
        ? projects
        : projects.filter((d) => [...pendingPkgs].some((pkg) => projectsDependingOn(projects, pkg).includes(d)));
      const what = pendingAll ? 'shared input' : [...pendingPkgs].join(', ');
      pendingPkgs.clear();
      pendingAll = false;
      log(`[dev-watch] ${what} changed — re-checking ${targets.length} of ${projects.length} projects`);
      touchProjectConfigs(targets);
    } catch (err) {
      log(`[dev-watch] re-check failed: ${err.message}`);
    }
  }, debounceMs);

  // `tsc -b --watch` re-reads the solution file but never builds a project newly added to
  // it (TypeScript 5.9), so a plugin registered while `pnpm dev` runs would be ignored.
  // Restart tsc when the project list changes; projects that are up to date are skipped.
  // Restarts are serialized so overlapping solution changes never spawn two tsc processes.
  let restartChain = Promise.resolve();
  const solutionChanged = createDebounce(() => {
    restartChain = restartChain.then(async () => {
      if (stopped) return;
      let next;
      try {
        next = readSolutionProjects(solutionPath);
      } catch {
        return; // mid-write or invalid JSON; the next event will retry
      }
      if (JSON.stringify(next) === JSON.stringify(projectDirs)) return;
      const added = next.filter((d) => !projectDirs.includes(d));
      projectDirs = next;
      log(`[dev-watch] solution projects changed — restarting tsc${added.length ? ` (new: ${added.map((d) => path.relative(rootDir, d)).join(', ')})` : ''}`);
      try {
        runAssetScripts(added, log);
      } catch (err) {
        log(`[dev-watch] assets script failed: ${err.message}`);
      }
      restarting = true;
      await killTsc();
      restarting = false;
      if (!stopped) spawnTsc();
    }).catch((err) => log(`[dev-watch] restart failed: ${err.message}`));
  }, debounceMs);

  // Set up every file watcher before spawning tsc: if one throws (e.g. ENOSPC, EACCES),
  // nothing has been started that could be left running.
  const watchers = [];
  try {
    for (const { dir, pkg } of sharedInputs) {
      if (!fs.existsSync(dir)) {
        log(`[dev-watch] skipping missing shared input dir: ${dir}`);
        continue;
      }
      const watcher = fs.watch(dir, { recursive: true }, () => {
        if (pkg) pendingPkgs.add(pkg);
        else pendingAll = true;
        recheck.trigger();
      });
      watcher.on('error', (err) => log(`[dev-watch] watcher error on ${dir}: ${err.message}`));
      watchers.push(watcher);
    }
    // Watch the directory (not the file) so atomic replaces of the solution file are seen too.
    const solutionWatcher = fs.watch(path.dirname(solutionPath), (_event, filename) => {
      if (filename === path.basename(solutionPath)) solutionChanged.trigger();
    });
    solutionWatcher.on('error', (err) => log(`[dev-watch] watcher error on ${solutionPath}: ${err.message}`));
    watchers.push(solutionWatcher);

    runAssetScripts(projectDirs, log);
  } catch (err) {
    for (const w of watchers) w.close();
    throw err;
  }

  // Shared inputs that changed while the watcher was stopped would otherwise go unnoticed.
  try {
    const stale = staleProjects(projectDirs, sharedInputs);
    if (stale.length > 0) {
      log(`[dev-watch] shared inputs changed since the last build — re-checking ${stale.length} of ${projectDirs.length} projects`);
      touchProjectConfigs(stale);
    }
  } catch (err) {
    log(`[dev-watch] startup re-check skipped: ${err.message}`);
  }

  spawnTsc();

  let stopping = null;
  function stop() {
    if (stopping) return stopping;
    stopped = true;
    stopping = (async () => {
      recheck.cancel();
      solutionChanged.cancel();
      for (const w of watchers) w.close();
      await restartChain;
      await killTsc();
    })();
    return stopping;
  }

  return {
    get child() { return child; },
    stop,
    exited,
  };
}

function parseArgs(argv) {
  const opts = { root: REPO_ROOT, solution: null, shared: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') opts.root = path.resolve(argv[++i]);
    else if (arg === '--solution') opts.solution = path.resolve(argv[++i]);
    else if (arg === '--shared') {
      // --shared <dir>[=<package>]: with a package, only projects depending on it are re-checked.
      const [dir, pkg] = argv[++i].split('=');
      opts.shared.push(pkg ? { dir: path.resolve(dir), pkg } : { dir: path.resolve(dir) });
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.solution) opts.solution = path.join(opts.root, 'tsconfig.dev.json');
  if (opts.shared.length === 0) {
    opts.shared = [
      { dir: path.join(opts.root, 'packages', 'ui', 'src'), pkg: '@saas/ui' },
      { dir: path.join(opts.root, 'packages', 'database', 'generated'), pkg: '@saas/database' },
    ];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const watch = startDevWatch({
    rootDir: opts.root,
    solutionPath: opts.solution,
    sharedInputDirs: opts.shared,
    // The TypeScript binary always comes from this repo, even when --root points elsewhere.
    tscPath: resolveTsc(REPO_ROOT),
    pretty: Boolean(process.stdout.isTTY),
  });

  // Whatever ends this process, never leave tsc running on its own.
  process.on('exit', () => {
    const { child } = watch;
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await watch.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (err) => {
    console.error('[dev-watch] crashed:', err);
    shutdown(1);
  });

  watch.exited.then((code) => {
    if (!shuttingDown) process.exit(code ?? 1);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  readSolutionProjects,
  touchProjectConfigs,
  createDebounce,
  runAssetScripts,
  resolveTsc,
  apiOutputFingerprint,
  projectsDependingOn,
  staleProjects,
  startDevWatch,
  API_RELOAD_STAMP,
};
