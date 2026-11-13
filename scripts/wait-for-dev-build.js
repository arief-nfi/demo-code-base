#!/usr/bin/env node

/**
 * Wait until the dev watcher (`pnpm dev:watch`) has built every project in
 * tsconfig.dev.json and completed a build cycle, then exit 0.
 *
 * The API loads packages/backend and the plugins from their `dist`. On a fresh clone
 * (no dist yet) `nest start --watch` would start first, its type checker would fail to
 * resolve `@saas/backend`, and the API would never come up. `apps/api`'s dev script
 * runs this first; on a warm start (dist already built) it exits immediately.
 *
 * "Built" means each project's package.json `main` and `types` files exist, and the
 * watcher's `.dev-watch/api-reload.stamp` exists (written at the end of its first
 * completed cycle). A tsbuildinfo alone does not count: `tsc --noEmit` writes one too.
 *
 * Usage: node scripts/wait-for-dev-build.js [--solution <file>] [--stamp <file>] [--interval <ms>] [--timeout <ms>]
 */

const fs = require('fs');
const path = require('path');
const { readSolutionProjects, API_RELOAD_STAMP } = require('./dev-watch');

const REPO_ROOT = path.resolve(__dirname, '..');

function projectOutputs(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return [path.join(dir, 'dist')];
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return [pkg.main, pkg.types].filter(Boolean).map((f) => path.join(dir, f));
}

/** Projects whose compiled entry points (package.json main/types) do not exist yet. */
function pendingProjects(solutionPath) {
  return readSolutionProjects(solutionPath).filter((dir) => !projectOutputs(dir).every((f) => fs.existsSync(f)));
}

function parseArgs(argv) {
  const opts = {
    solution: path.join(REPO_ROOT, 'tsconfig.dev.json'),
    stamp: path.join(REPO_ROOT, API_RELOAD_STAMP),
    interval: 500,
    timeout: 10 * 60 * 1000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--solution') opts.solution = path.resolve(argv[++i]);
    else if (arg === '--stamp') opts.stamp = path.resolve(argv[++i]);
    else if (arg === '--interval') opts.interval = Number(argv[++i]);
    else if (arg === '--timeout') opts.timeout = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function main() {
  const { solution, stamp, interval, timeout } = parseArgs(process.argv.slice(2));
  const ready = () => pendingProjects(solution).length === 0 && fs.existsSync(stamp);
  if (ready()) return;

  const total = readSolutionProjects(solution).length;
  console.log(`[dev] waiting for the dev watcher's first build (${pendingProjects(solution).length}/${total} projects not built yet)...`);
  const deadline = Date.now() + timeout;
  const timer = setInterval(() => {
    if (ready()) {
      clearInterval(timer);
      console.log('[dev] dev watcher build ready');
      return;
    }
    if (Date.now() > deadline) {
      clearInterval(timer);
      const pending = pendingProjects(solution).map((d) => path.relative(REPO_ROOT, d));
      console.error(`[dev] timed out waiting for the dev watcher (${pending.length ? `not built: ${pending.join(', ')}` : 'no completed build cycle yet'})`);
      process.exit(1);
    }
  }, interval);
}

if (require.main === module) {
  main();
}

module.exports = { pendingProjects };
