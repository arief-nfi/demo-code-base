const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const headerPath = path.join(repoRoot, 'packages', 'database', 'prisma', 'header.prisma');
const outPath = path.join(repoRoot, 'packages', 'database', 'prisma', 'schema.prisma');
const pluginsDir = path.join(repoRoot, 'plugins');

// CLI flags
const args = process.argv.slice(2);
const isCheckMode = args.includes('--check');
const isVerbose = args.includes('--verbose');

function log(msg) { console.log(msg); }
function verbose(msg) { if (isVerbose) console.log(`  [verbose] ${msg}`); }

// Core model names that plugins must not redefine
const RESERVED_MODELS = [
  'Tenant', 'User', 'Role', 'Permission', 'TenantConfig',
  'AuditLog', 'AuditConfig', 'Plugin',
];

function findFragments(pluginsRoot) {
  const fragments = [];
  if (!fs.existsSync(pluginsRoot)) return fragments;
  for (const pluginName of fs.readdirSync(pluginsRoot)) {
    const prismaDir = path.join(pluginsRoot, pluginName, 'src', 'database', 'prisma');
    if (!fs.existsSync(prismaDir)) continue;
    for (const file of fs.readdirSync(prismaDir)) {
      if (file.endsWith('.prisma')) {
        const filePath = path.join(prismaDir, file);
        fragments.push({
          plugin: pluginName,
          path: filePath,
          content: fs.readFileSync(filePath, 'utf8'),
        });
      }
    }
  }
  return fragments;
}

function validateFragments(fragments) {
  const errors = [];
  const warnings = [];
  const modelNames = new Map();  // modelName -> pluginKey
  const enumNames = new Map();   // enumName -> pluginKey

  for (const frag of fragments) {
    const { plugin, content, path: filePath } = frag;
    const relPath = path.relative(repoRoot, filePath);

    // Check for forbidden blocks
    if (/datasource\s+\w+\s*\{/.test(content)) {
      errors.push(
        `[${plugin}] Fragment must not contain 'datasource' block (${relPath})`
      );
    }
    if (/generator\s+\w+\s*\{/.test(content)) {
      errors.push(
        `[${plugin}] Fragment must not contain 'generator' block (${relPath})`
      );
    }

    // Extract model declarations
    const modelRegex = /model\s+(\w+)\s*\{/g;
    let match;
    while ((match = modelRegex.exec(content)) !== null) {
      const modelName = match[1];

      // Check reserved names
      if (RESERVED_MODELS.includes(modelName)) {
        errors.push(
          `[${plugin}] Model '${modelName}' is reserved by the core system (${relPath})`
        );
        continue;
      }

      // Check duplicates across plugins
      if (modelNames.has(modelName)) {
        errors.push(
          `[${plugin}] Duplicate model '${modelName}' — already defined by '${modelNames.get(modelName)}' (${relPath})`
        );
      } else {
        modelNames.set(modelName, plugin);
      }
    }

    // Extract enum declarations
    const enumRegex = /enum\s+(\w+)\s*\{/g;
    while ((match = enumRegex.exec(content)) !== null) {
      const enumName = match[1];
      if (enumNames.has(enumName)) {
        errors.push(
          `[${plugin}] Duplicate enum '${enumName}' — already defined by '${enumNames.get(enumName)}' (${relPath})`
        );
      } else {
        enumNames.set(enumName, plugin);
      }
    }

    // Warn about missing @@map
    const modelBlocks = [...content.matchAll(/model\s+(\w+)\s*\{([^}]+)\}/gs)];
    const modelsWithoutMap = [];
    for (const [, name, body] of modelBlocks) {
      if (RESERVED_MODELS.includes(name)) continue;
      if (!body.includes('@@map(')) {
        modelsWithoutMap.push(name);
      }
    }
    if (modelsWithoutMap.length > 0) {
      warnings.push(
        `[${plugin}] Models without @@map(): ${modelsWithoutMap.join(', ')}. ` +
        `Consider adding @@map("${plugin}_table_name") to prevent table collisions.`
      );
    }
  }

  return { errors, warnings };
}

function merge(options = {}) {
  const check = options.check ?? isCheckMode;

  const header = fs.existsSync(headerPath) ? fs.readFileSync(headerPath, 'utf8') : '';
  const fragments = findFragments(pluginsDir);

  verbose(`Found ${fragments.length} fragment(s)`);

  // Validate fragments
  const { errors, warnings } = validateFragments(fragments);

  // Print warnings
  for (const w of warnings) {
    console.warn(`  ⚠  ${w}`);
  }

  // If there are errors, report and abort
  if (errors.length > 0) {
    console.error('');
    console.error('Prisma fragment validation failed:');
    for (const e of errors) {
      console.error(`  ✗  ${e}`);
    }
    if (check) {
      process.exit(1);
    }
    throw new Error(`Prisma fragment validation failed with ${errors.length} error(s)`);
  }

  if (check) {
    log(`✓ All Prisma fragments valid (${fragments.length} fragment(s))`);
    return;
  }

  // Build merged output
  const parts = [];
  if (header.trim()) parts.push(header.trim());
  parts.push('\n// --- plugin fragments ---\n');

  for (const f of fragments) {
    const txt = f.content.trim();
    parts.push(`// plugin: ${f.plugin} - ${path.basename(f.path)}\n${txt}\n`);
  }

  const content = parts.join('\n\n');
  fs.writeFileSync(outPath, content, 'utf8');
  log(`Merged ${fragments.length} fragments -> ${outPath}`);
}

if (require.main === module) {
  if (isCheckMode) log('[check mode] Validating Prisma fragments...\n');
  merge();
}

module.exports = { merge };
