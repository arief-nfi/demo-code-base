#!/usr/bin/env node

/**
 * Plugin Development CLI
 *
 * Streamlines the plugin development loop:
 * - Watches plugin structural files and auto-regenerates registry
 * - Optionally starts pnpm dev (API + Web + the shared watcher that builds all plugins)
 *
 * Usage:
 *   pnpm plugin:dev <plugin-name>          # Full dev mode (registry watch + pnpm dev)
 *   pnpm plugins:watch                     # Watch-only (auto-registry regeneration)
 *   pnpm plugin:dev <plugin-name> --watch-only  # Watch a specific plugin only
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pluginsDir = path.join(rootDir, 'plugins');
const registryScript = path.join(__dirname, 'generate-registry.js');

// ── CLI parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const watchOnly = args.includes('--watch-only');
const pluginName = args.find(a => !a.startsWith('--'));

if (!watchOnly && !pluginName) {
  console.log(`
Plugin Dev CLI

Usage:
  pnpm plugin:dev <plugin-name>              Full dev mode (registry watch + pnpm dev)
  pnpm plugin:dev <plugin-name> --watch-only Watch plugin and auto-regenerate registry
  pnpm plugins:watch                         Watch all plugins and auto-regenerate registry

Examples:
  pnpm plugin:dev my-plugin
  pnpm plugin:dev my-plugin --watch-only
`);
  process.exit(0);
}

// ── Validate plugin ─────────────────────────────────────────────────────

if (pluginName) {
  const pluginDir = path.join(pluginsDir, pluginName);
  if (!fs.existsSync(pluginDir)) {
    console.error(`Plugin '${pluginName}' not found in plugins/ directory`);
    console.error(`Available plugins: ${getAvailablePlugins().join(', ') || '(none)'}`);
    process.exit(1);
  }
}

function getAvailablePlugins() {
  if (!fs.existsSync(pluginsDir)) return [];
  return fs.readdirSync(pluginsDir)
    .filter(f => fs.statSync(path.join(pluginsDir, f)).isDirectory());
}

// ── File watching ───────────────────────────────────────────────────────

const STRUCTURAL_FILES = [
  'src/api/index.ts',
  'src/permissions.ts',
  'src/web/menus.ts',
  'src/web/index.ts',
  'src/dictionaries.ts',
  'src/lifecycle.ts',
  'src/config.schema.ts',
  'package.json',
];

let registryTimeout = null;
const children = [];

function debounceRegistryRegenerate(changedFile) {
  console.log(`[watch] Changed: ${changedFile}`);
  clearTimeout(registryTimeout);
  registryTimeout = setTimeout(() => {
    console.log('[registry] Regenerating plugin registry...');
    try {
      execSync(`node ${registryScript}`, { cwd: rootDir, stdio: 'inherit' });
      console.log('[registry] Done.\n');
    } catch {
      console.error('[registry] Registry regeneration failed.\n');
    }
  }, 500);
}

function watchPlugin(name) {
  const pluginDir = path.join(pluginsDir, name);
  console.log(`[watch] Watching structural files in ${name}/`);

  for (const relFile of STRUCTURAL_FILES) {
    const filePath = path.join(pluginDir, relFile);
    const fileDir = path.dirname(filePath);

    // Watch directory containing the file (fs.watch on files can be unreliable)
    if (fs.existsSync(fileDir)) {
      try {
        fs.watch(fileDir, (eventType, filename) => {
          if (filename === path.basename(relFile)) {
            debounceRegistryRegenerate(`${name}/${relFile}`);
          }
        });
      } catch {
        // Silently skip files that can't be watched
      }
    }
  }
}

// ── Start watching ──────────────────────────────────────────────────────

const pluginsToWatch = pluginName ? [pluginName] : getAvailablePlugins();

if (pluginsToWatch.length === 0) {
  console.error('No plugins found to watch.');
  process.exit(1);
}

console.log(`\n🔧 Plugin Dev CLI\n`);

for (const name of pluginsToWatch) {
  watchPlugin(name);
}

if (watchOnly) {
  console.log(`[mode] Watch-only mode — auto-regenerating registry on structural changes\n`);
  console.log('Press Ctrl+C to stop.\n');
} else {
  console.log(`[mode] Full dev mode for plugin '${pluginName}'\n`);

  // Start pnpm dev (turbo dev). It includes the shared watcher (`pnpm dev:watch`),
  // which already type-checks and builds this plugin, so no per-plugin tsc is started.
  const dev = spawn('pnpm', ['dev'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });
  children.push(dev);

  console.log('[dev] Started API + Web dev servers and the shared watcher\n');
}

// ── Cleanup ─────────────────────────────────────────────────────────────

function cleanup() {
  console.log('\n[cleanup] Shutting down...');
  clearTimeout(registryTimeout);
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
