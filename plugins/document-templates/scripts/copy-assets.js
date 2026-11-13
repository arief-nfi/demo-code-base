#!/usr/bin/env node
/**
 * Copy non-TypeScript assets from src/ into dist/, preserving relative paths.
 *
 * `tsc` only emits compiled .ts/.tsx output, but DefaultsService reads the
 * default document templates (src/api/defaults/templates/*.html) at runtime
 * relative to its compiled location (dist/api/defaults/templates). Run this
 * before `tsc` in both `build` and `dev`.
 */
const fs = require('fs');
const path = require('path');

const ASSET_EXTENSIONS = new Set(['.html']);
const pluginRoot = path.resolve(__dirname, '..');
const srcDir = path.join(pluginRoot, 'src');
const distDir = path.join(pluginRoot, 'dist');

function copyAssets(dir) {
  let copied = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      copied += copyAssets(fullPath);
    } else if (ASSET_EXTENSIONS.has(path.extname(entry.name))) {
      const target = path.join(distDir, path.relative(srcDir, fullPath));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(fullPath, target);
      copied++;
    }
  }
  return copied;
}

const count = copyAssets(srcDir);
console.log(`[document-templates] Copied ${count} asset file(s) to dist/`);
