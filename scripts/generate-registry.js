const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const semver = require('semver');

const rootDir = path.resolve(__dirname, '..');
const pluginsDir = path.join(rootDir, 'plugins');
const apiDir = path.join(rootDir, 'apps/api');
const webDir = path.join(rootDir, 'apps/web');
const CACHE_FILE = path.join(rootDir, '.plugin-registry-cache.json');

// CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerbose = args.includes('--verbose');
const isCheckMode = args.includes('--check');
const isIncremental = args.includes('--incremental');

function log(msg) { console.log(msg); }
function verbose(msg) { if (isVerbose) console.log(`  [verbose] ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }
function error(msg) { console.error(`  ✗  ${msg}`); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPascalCase(str) {
  return str.replace(/(^\w|-\w)/g, (text) => text.replace(/-/, '').toUpperCase());
}

function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Recursively follows `export * from '...'` to collect all exported content.
 * Returns concatenated content of all transitively exported files.
 */
function collectExports(filePath, visited = new Set()) {
  if (visited.has(filePath)) return '';
  visited.add(filePath);

  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf-8');

  let result = content;
  const reExportRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = reExportRegex.exec(content)) !== null) {
    const specifier = m[1];
    const dir = path.dirname(filePath);
    // Resolve relative path, try .ts and .tsx extensions
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const resolved = path.join(dir, specifier + ext);
      if (fs.existsSync(resolved)) {
        result += '\n' + collectExports(resolved, visited);
        break;
      }
    }
  }

  return result;
}

// ─── Incremental Cache ───────────────────────────────────────────────────────

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n');
}

function walkFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      results.push(...walkFiles(fullPath, extensions));
    } else if (extensions.some(ext => item.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

function computePluginHash(pluginDir) {
  const files = [
    path.join(pluginDir, 'package.json'),
    ...walkFiles(path.join(pluginDir, 'src'), ['.ts', '.tsx', '.prisma']),
  ].filter(f => fs.existsSync(f)).sort();

  const hash = crypto.createHash('md5');
  for (const file of files) {
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validatePackageJson(pkg, pluginDir) {
  const errors = [];

  if (!pkg.name) errors.push(`Missing "name" in ${pluginDir}/package.json`);
  if (!pkg.version) errors.push(`Missing "version" in ${pluginDir}/package.json`);
  if (!pkg.exports) errors.push(`Missing "exports" in ${pluginDir}/package.json`);
  if (pkg.exports && !pkg.exports['./api']) {
    errors.push(`Missing "./api" export in ${pluginDir}/package.json`);
  }

  return errors;
}

function validatePermissionNamespace(pluginKey, permissions, pluginDir) {
  const errors = [];
  for (const perm of permissions) {
    if (!perm.name.startsWith(`${pluginKey}.`)) {
      errors.push(
        `Permission "${perm.name}" in ${pluginDir}/src/permissions.ts must start with "${pluginKey}." (namespace enforcement)`
      );
      continue;
    }
    // Enforce format: {plugin-key}.{resource}.{action}
    const parts = perm.name.split('.');
    if (parts.length < 3) {
      errors.push(
        `Permission "${perm.name}" in ${pluginDir}/src/permissions.ts must follow format: {plugin-key}.{resource}.{action}`
      );
    }
  }
  return errors;
}

function validateRouteNamespace(pluginKey, controllerFiles) {
  const errors = [];
  const expectedPrefix = `plugins/${pluginKey}`;

  for (const file of controllerFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    // Match @Controller('...') decorators
    const controllerRegex = /@Controller\(['"`]([^'"`]+)['"`]\)/g;
    let m;
    while ((m = controllerRegex.exec(content)) !== null) {
      const route = m[1];
      // Plugin routes must be under /plugins/{pluginKey}/...
      // Exception: the route IS exactly the plugin key (legacy, warn only)
      if (!route.startsWith(expectedPrefix) && route !== pluginKey) {
        errors.push(
          `Controller route "${route}" in ${path.relative(rootDir, file)} should start with "${expectedPrefix}" (namespace enforcement)`
        );
      }
    }
  }
  return errors;
}

function validateDictionaryNamespace(pluginKey, dictionaryFile) {
  const warnings = [];
  if (!fs.existsSync(dictionaryFile)) return warnings;

  const content = fs.readFileSync(dictionaryFile, 'utf-8');
  const camelKey = toCamelCase(pluginKey);

  // Check that the top-level dictionary key matches the plugin's camelCase name
  // Look for patterns like: pluginName: { ... }
  const keyRegex = /^\s+(\w+):\s*\{/gm;
  let m;
  while ((m = keyRegex.exec(content)) !== null) {
    const key = m[1];
    // Skip 'en', 'id', or other locale keys
    if (['en', 'id', 'de', 'fr', 'es', 'pt', 'ja', 'ko', 'zh'].includes(key)) continue;
    if (key !== camelKey) {
      warnings.push(
        `Dictionary key "${key}" in ${path.relative(rootDir, dictionaryFile)} should be "${camelKey}" to match plugin namespace`
      );
    }
  }
  return warnings;
}

function checkDuplicates(plugins) {
  const errors = [];

  // Check duplicate plugin keys
  const keys = new Map();
  for (const p of plugins) {
    if (keys.has(p.dirName)) {
      errors.push(`Duplicate plugin key: "${p.dirName}" (found in ${keys.get(p.dirName)} and ${p.dirName})`);
    }
    keys.set(p.dirName, p.dirName);
  }

  // Check duplicate permission names across all plugins
  const permNames = new Map();
  for (const p of plugins) {
    if (!p.permissions) continue;
    for (const perm of p.permissions) {
      if (permNames.has(perm.name)) {
        errors.push(
          `Duplicate permission name: "${perm.name}" (defined in both "${permNames.get(perm.name)}" and "${p.dirName}")`
        );
      }
      permNames.set(perm.name, p.dirName);
    }
  }

  return errors;
}

function validatePluginDependencies(plugins) {
  const errors = [];
  const pluginMap = new Map(plugins.map(p => [p.dirName, p]));

  // Read core version from root package.json
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  const coreVersion = rootPkg.version || '0.0.0';

  for (const plugin of plugins) {
    if (!plugin.manifest) continue;

    // Check pluginDependencies
    const deps = plugin.manifest.pluginDependencies || {};
    for (const [depKey, depRange] of Object.entries(deps)) {
      const depPlugin = pluginMap.get(depKey);
      if (!depPlugin) {
        errors.push(
          `Plugin "${plugin.dirName}" depends on "${depKey}" which does not exist`
        );
        continue;
      }
      if (depRange && depPlugin.version && !semver.satisfies(depPlugin.version, depRange)) {
        errors.push(
          `Plugin "${plugin.dirName}" requires "${depKey}@${depRange}" but found version "${depPlugin.version}"`
        );
      }
    }

    // Check pluginConflicts
    const conflictKeys = plugin.manifest.pluginConflicts || [];
    for (const conflictKey of conflictKeys) {
      if (pluginMap.has(conflictKey)) {
        errors.push(
          `Plugin "${plugin.dirName}" conflicts with "${conflictKey}" which is present`
        );
      }
    }

    // Check coreCompatibility
    const coreCompat = plugin.manifest.coreCompatibility;
    if (coreCompat && coreVersion && !semver.satisfies(coreVersion, coreCompat)) {
      errors.push(
        `Plugin "${plugin.dirName}" requires core "${coreCompat}" but found version "${coreVersion}"`
      );
    }
  }

  return errors;
}

function detectCircularDependencies(plugins) {
  const errors = [];
  const adj = new Map();

  for (const plugin of plugins) {
    const deps = plugin.manifest?.pluginDependencies
      ? Object.keys(plugin.manifest.pluginDependencies)
      : [];
    adj.set(plugin.dirName, deps);
  }

  // DFS cycle detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const key of adj.keys()) color.set(key, WHITE);

  function dfs(node, path) {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of (adj.get(node) || [])) {
      if (!adj.has(neighbor)) continue; // non-existent dep, caught by other validator
      if (color.get(neighbor) === GRAY) {
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart).concat(neighbor);
        errors.push(`Circular plugin dependency detected: ${cycle.join(' → ')}`);
        return;
      }
      if (color.get(neighbor) === WHITE) {
        dfs(neighbor, path);
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const key of adj.keys()) {
    if (color.get(key) === WHITE) {
      dfs(key, []);
    }
  }

  return errors;
}

function validatePluginExports(plugin, pluginPath, pkg) {
  const errors = [];
  const exports = pkg.exports || {};

  // Map feature flags to their expected export paths
  const featureExports = [
    { flag: 'hasPermissions', exportKey: './permissions', label: 'permissions' },
    { flag: 'hasWebMenus', exportKey: './menus', label: 'menus' },
    { flag: 'hasDictionaries', exportKey: './dictionaries', label: 'dictionaries' },
    { flag: 'hasLifecycle', exportKey: './lifecycle', label: 'lifecycle' },
    { flag: 'hasConfigSchema', exportKey: './config-schema', label: 'config schema' },
    { flag: 'hasEmails', exportKey: './emails', label: 'emails' },
  ];

  for (const { flag, exportKey, label } of featureExports) {
    if (!plugin[flag]) continue;
    if (!exports[exportKey]) {
      errors.push(
        `Plugin "${plugin.dirName}" has ${label} source but missing "${exportKey}" export in package.json`
      );
    }
  }

  // Verify api/index.ts can resolve the discovered module class names
  const apiIndexPath = path.join(pluginPath, 'src', 'api', 'index.ts');
  if (fs.existsSync(apiIndexPath)) {
    // Collect all exported symbols by following export * from chains
    const allExportedContent = collectExports(apiIndexPath);
    for (const mod of plugin.modules) {
      if (!allExportedContent.includes(mod)) {
        errors.push(
          `Plugin "${plugin.dirName}" module "${mod}" not found in api exports`
        );
      }
    }
  }

  return errors;
}

function validateMenuHrefs(pluginKey, menuFile) {
  const errors = [];
  if (!fs.existsSync(menuFile)) return errors;

  const content = fs.readFileSync(menuFile, 'utf-8');
  const expectedPrefix = `/plugins/${pluginKey}`;

  // Extract href values
  const hrefRegex = /href:\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = hrefRegex.exec(content)) !== null) {
    const href = m[1];
    if (!href.startsWith(expectedPrefix)) {
      errors.push(
        `Plugin "${pluginKey}" menu href "${href}" must start with "${expectedPrefix}" (${path.relative(rootDir, menuFile)})`
      );
    }
  }

  return errors;
}

// ─── Discovery ────────────────────────────────────────────────────────────────

function getPlugins() {
  if (!fs.existsSync(pluginsDir)) {
    log('No plugins directory found.');
    return [];
  }

  const items = fs.readdirSync(pluginsDir);
  const plugins = [];
  const allErrors = [];
  const allWarnings = [];

  for (const item of items) {
    const itemPath = path.join(pluginsDir, item);
    if (!fs.statSync(itemPath).isDirectory()) continue;

    const packageJsonPath = path.join(itemPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      warn(`Skipping ${item}: no package.json found`);
      continue;
    }

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Validate package.json
    const pkgErrors = validatePackageJson(pkg, item);
    if (pkgErrors.length > 0) {
      allErrors.push(...pkgErrors);
      continue;
    }

    const hasWebMenus = fs.existsSync(path.join(itemPath, 'src', 'web', 'menus.ts')) ||
                        fs.existsSync(path.join(itemPath, 'src', 'web', 'menus.tsx'));
    const hasPermissions = fs.existsSync(path.join(itemPath, 'src', 'permissions.ts'));
    const hasDictionaries = fs.existsSync(path.join(itemPath, 'src', 'dictionaries.ts'));
    const hasLifecycle = fs.existsSync(path.join(itemPath, 'src', 'lifecycle.ts'));
    const hasConfigSchema = fs.existsSync(path.join(itemPath, 'src', 'config.schema.ts'));
    const hasEmails = fs.existsSync(path.join(itemPath, 'src', 'emails.ts'));
    const pascalName = toPascalCase(item);
    const modules = findApiModules(itemPath, pascalName);

    // Load and validate permissions
    let permissions = [];
    if (hasPermissions) {
      try {
        // Read the permission file and extract permission data
        permissions = extractPermissions(path.join(itemPath, 'src', 'permissions.ts'));
        const permErrors = validatePermissionNamespace(item, permissions, item);
        allErrors.push(...permErrors);
      } catch (e) {
        warn(`Could not parse permissions for ${item}: ${e.message}`);
      }
    }

    // Validate route namespaces
    const controllerFiles = findControllerFiles(itemPath);
    const routeErrors = validateRouteNamespace(item, controllerFiles);
    allWarnings.push(...routeErrors); // Warnings, not errors (for backwards compat)

    // Validate dictionary namespaces
    if (hasDictionaries) {
      const dictWarnings = validateDictionaryNamespace(item, path.join(itemPath, 'src', 'dictionaries.ts'));
      allWarnings.push(...dictWarnings);
    }

    // Validate menu hrefs
    if (hasWebMenus) {
      const menuFile = fs.existsSync(path.join(itemPath, 'src', 'web', 'menus.ts'))
        ? path.join(itemPath, 'src', 'web', 'menus.ts')
        : path.join(itemPath, 'src', 'web', 'menus.tsx');
      const menuErrors = validateMenuHrefs(item, menuFile);
      allErrors.push(...menuErrors);
    }

    // Extract plugin manifest
    const manifest = pkg.pluginManifest || null;
    const dependencies = manifest?.pluginDependencies ? Object.keys(manifest.pluginDependencies) : [];
    const conflicts = manifest?.pluginConflicts || [];

    verbose(`Plugin ${item}: modules=[${modules.join(', ')}] permissions=${hasPermissions} menus=${hasWebMenus} dictionaries=${hasDictionaries} lifecycle=${hasLifecycle} configSchema=${hasConfigSchema} manifest=${!!manifest}`);

    plugins.push({
      dirName: item,
      pkgName: pkg.name,
      pascalName,
      displayName: pkg.displayName || pascalName,
      description: pkg.description || '',
      version: pkg.version || '0.0.1',
      authorName: pkg.author?.name || null,
      authorEmail: pkg.author?.email || null,
      authorUrl: pkg.author?.url || null,
      hasWebMenus,
      hasPermissions,
      hasDictionaries,
      hasLifecycle,
      hasConfigSchema,
      hasEmails,
      modules,
      permissions,
      manifest,
      dependencies,
      conflicts,
    });
  }

  // Print warnings
  for (const w of allWarnings) {
    warn(w);
  }

  // Validate plugin exports
  for (const p of plugins) {
    const pluginPath = path.join(pluginsDir, p.dirName);
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginPath, 'package.json'), 'utf-8'));
    const exportErrors = validatePluginExports(p, pluginPath, pkg);
    allErrors.push(...exportErrors);
    allErrors.push(...validatePluginTsconfig(pluginPath).map((e) => `Plugin "${p.dirName}": ${e}`));
  }

  // Check cross-plugin duplicates
  const dupErrors = checkDuplicates(plugins);
  allErrors.push(...dupErrors);

  // Validate plugin dependencies and conflicts
  const depErrors = validatePluginDependencies(plugins);
  allErrors.push(...depErrors);

  // Detect circular dependencies
  const circularErrors = detectCircularDependencies(plugins);
  allErrors.push(...circularErrors);

  // If there are errors, report and exit
  if (allErrors.length > 0) {
    log('');
    log('Plugin registry validation failed:');
    for (const e of allErrors) {
      error(e);
    }
    process.exit(1);
  }

  return plugins;
}

function extractPermissions(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const permissions = [];

  // Match { name: '...', description: '...' } patterns
  const permRegex = /\{\s*name:\s*['"`]([^'"`]+)['"`](?:\s*,\s*description:\s*['"`]([^'"`]*)['"`])?\s*\}/g;
  let m;
  while ((m = permRegex.exec(content)) !== null) {
    permissions.push({ name: m[1], description: m[2] || '' });
  }

  return permissions;
}

function findControllerFiles(pluginPath) {
  const apiDir = path.join(pluginPath, 'src', 'api');
  if (!fs.existsSync(apiDir)) return [];

  const files = [];
  function walk(dir) {
    for (const it of fs.readdirSync(dir)) {
      const p = path.join(dir, it);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (it.endsWith('.controller.ts')) files.push(p);
    }
  }
  walk(apiDir);
  return files;
}

function findApiModules(pluginPath, pascalName) {
  const apiDir = path.join(pluginPath, 'src', 'api');
  if (!fs.existsSync(apiDir)) return [`${pascalName}Module`];

  const files = [];
  function walk(dir) {
    for (const it of fs.readdirSync(dir)) {
      const p = path.join(dir, it);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(it) && !it.endsWith('.d.ts')) files.push(p);
    }
  }
  walk(apiDir);

  const moduleNames = new Set();
  const classRegex = /export\s+class\s+([A-Za-z0-9_]+Module)\b/g;
  const namedExportRegex = /export\s*\{([^}]+)\}/g;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    let m;
    while ((m = classRegex.exec(content)) !== null) {
      moduleNames.add(m[1]);
    }

    while ((m = namedExportRegex.exec(content)) !== null) {
      const parts = m[1].split(',').map(s => s.trim());
      for (const part of parts) {
        const name = part.split(/\s+as\s+/)[0].trim();
        if (name.endsWith('Module')) moduleNames.add(name);
      }
    }
  }

  if (moduleNames.size === 0) return [`${pascalName}Module`];
  return Array.from(moduleNames);
}

// ─── Code Generation ──────────────────────────────────────────────────────────

function generateApiRegistryContent(plugins) {
  // Module imports
  const imports = plugins.map(p => {
    const mods = (p.modules && p.modules.length) ? p.modules.join(', ') : `${p.pascalName}Module`;
    return `import { ${mods} } from '${p.pkgName}/api';`;
  }).join('\n');

  // Permission imports
  const permissionImports = plugins
    .filter(p => p.hasPermissions)
    .map(p => `import { ${p.pascalName}Permissions } from '${p.pkgName}/permissions';`)
    .join('\n');

  // Lifecycle imports
  const lifecycleImports = plugins
    .filter(p => p.hasLifecycle)
    .map(p => `import { ${p.pascalName}Lifecycle } from '${p.pkgName}/lifecycle';`)
    .join('\n');

  // Config schema imports
  const configSchemaImports = plugins
    .filter(p => p.hasConfigSchema)
    .map(p => `import { ${toCamelCase(p.pascalName)}ConfigSchema } from '${p.pkgName}/config-schema';`)
    .join('\n');

  // Email definition imports
  const emailImports = plugins
    .filter(p => p.hasEmails)
    .map(p => `import { ${toCamelCase(p.pascalName)}Emails } from '${p.pkgName}/emails';`)
    .join('\n');

  // Flatten all modules
  const allModules = [];
  plugins.forEach(p => {
    if (p.modules && p.modules.length) {
      p.modules.forEach(m => allModules.push(m));
    } else {
      allModules.push(`${p.pascalName}Module`);
    }
  });

  const modulesExport = `export const PluginModules = [\n  ${allModules.join(',\n  ')}\n];`;

  // Permissions export
  const permissionsWithData = plugins.filter(p => p.hasPermissions);
  const permissionsExport = permissionsWithData.length > 0
    ? `export const PluginPermissions: Record<string, Array<{ name: string; description?: string }>> = {\n  ${permissionsWithData.map(p => `'${p.dirName}': ${p.pascalName}Permissions`).join(',\n  ')}\n};`
    : 'export const PluginPermissions: Record<string, Array<{ name: string; description?: string }>> = {};';

  // Lifecycle export
  const lifecyclePlugins = plugins.filter(p => p.hasLifecycle);
  const lifecyclesExport = lifecyclePlugins.length > 0
    ? `export const PluginLifecycles: Record<string, PluginLifecycle> = {\n  ${lifecyclePlugins.map(p => `'${p.dirName}': ${p.pascalName}Lifecycle`).join(',\n  ')}\n};`
    : 'export const PluginLifecycles: Record<string, PluginLifecycle> = {};';

  // Config schemas export
  const configSchemaPlugins = plugins.filter(p => p.hasConfigSchema);
  const configSchemasExport = configSchemaPlugins.length > 0
    ? `// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const PluginConfigSchemas: Record<string, ZodObject<any>> = {\n  ${configSchemaPlugins.map(p => `'${p.dirName}': ${toCamelCase(p.pascalName)}ConfigSchema`).join(',\n  ')}\n};`
    : '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const PluginConfigSchemas: Record<string, ZodObject<any>> = {};';

  // Email definitions export (validated by the API's EmailDefinitionsRegistry at boot)
  const emailPlugins = plugins.filter(p => p.hasEmails);
  const emailsExport = emailPlugins.length > 0
    ? `export const PluginEmails: Record<string, EmailDefinition[]> = {\n  ${emailPlugins.map(p => `'${p.dirName}': ${toCamelCase(p.pascalName)}Emails`).join(',\n  ')}\n};`
    : 'export const PluginEmails: Record<string, EmailDefinition[]> = {};';

  // Plugin list (with dependencies & conflicts)
  const listData = plugins.map(p => ({
    key: p.dirName,
    name: p.displayName,
    description: p.description,
    version: p.version,
    authorName: p.authorName,
    authorEmail: p.authorEmail,
    authorUrl: p.authorUrl,
    dependencies: p.dependencies,
    conflicts: p.conflicts,
  }));
  const listExport = `export const PluginList = ${JSON.stringify(listData, null, 2)};`;

  // Plugin manifests
  const manifestEntries = plugins
    .filter(p => p.manifest)
    .map(p => `  '${p.dirName}': ${JSON.stringify(p.manifest, null, 2).replace(/\n/g, '\n  ')}`);
  const manifestsExport = `export const PluginManifests: Record<string, PluginManifest> = {\n${manifestEntries.join(',\n')}\n};`;

  // Plugin dependency graph
  const depGraphEntries = plugins.map(p =>
    `  '${p.dirName}': ${JSON.stringify(p.dependencies)}`
  );
  const depGraphExport = `export const PluginDependencyGraph: Record<string, string[]> = {\n${depGraphEntries.join(',\n')}\n};`;

  // Assemble
  const parts = ['// Auto-generated by scripts/generate-registry.js'];
  parts.push(imports);
  if (permissionImports) parts.push('', permissionImports);
  if (lifecycleImports) parts.push('', lifecycleImports);
  if (configSchemaImports) parts.push('', configSchemaImports);
  if (emailImports) parts.push('', emailImports);

  // Type imports
  parts.push('', `import type { EmailDefinition, PluginLifecycle, PluginManifest } from '@saas/backend';`);
  parts.push(`import type { ZodObject } from 'zod';`);

  parts.push('', modulesExport, '', permissionsExport, '', lifecyclesExport, '', configSchemasExport, '', emailsExport, '', listExport, '', manifestsExport, '', depGraphExport, '');

  return parts.join('\n');
}

function updateApiRegistry(plugins) {
  const registryPath = path.join(apiDir, 'src/plugin-registry.ts');
  const content = generateApiRegistryContent(plugins);

  // Log detected plugins
  plugins.forEach(p => {
    log(`  Plugin "${p.dirName}": modules=[${p.modules.join(', ')}]${p.hasPermissions ? ' +permissions' : ''}${p.hasLifecycle ? ' +lifecycle' : ''}${p.hasConfigSchema ? ' +config' : ''}${p.hasEmails ? ' +emails' : ''}${p.hasWebMenus ? ' +menus' : ''}${p.hasDictionaries ? ' +dictionaries' : ''}`);
  });

  if (isDryRun) {
    log(`[dry-run] Would write API registry to ${registryPath}`);
    verbose(content);
  } else {
    fs.writeFileSync(registryPath, content);
    log(`Updated API registry at ${registryPath}`);
  }

  return content;
}

const DEV_SOLUTION_FILE = 'tsconfig.dev.json';

/**
 * Root solution tsconfig used by the dev watcher (`scripts/dev-watch.js`, one
 * `tsc -b --watch` for packages/backend + every plugin). Backend first, then
 * plugins sorted by directory name.
 */
function generateDevSolutionContent(plugins) {
  const pluginRefs = plugins
    .map((p) => p.dirName)
    .sort()
    .map((dirName) => ({ path: `plugins/${dirName}` }));
  return JSON.stringify({ files: [], references: [{ path: 'packages/backend' }, ...pluginRefs] }, null, 2) + '\n';
}

/**
 * A plugin must be a composite project referencing packages/backend, or the
 * dev watcher (`tsc -b`) refuses to build it. Returns error messages ([] = valid).
 */
function validatePluginTsconfig(pluginDir) {
  const tsconfigPath = path.join(pluginDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) return ['tsconfig.json is missing'];
  let tsconfig;
  try {
    tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
  } catch (e) {
    return [`tsconfig.json is not valid JSON: ${e.message}`];
  }
  const opts = tsconfig.compilerOptions || {};
  const errors = [];
  if (opts.composite !== true) errors.push('tsconfig.json must set "composite": true (needed by the dev watcher, tsc -b)');
  if (!['./src', 'src'].includes(opts.rootDir)) errors.push('tsconfig.json must set "rootDir": "./src" (keeps dist layout identical under composite)');
  if (opts.tsBuildInfoFile !== './dist/tsconfig.tsbuildinfo') errors.push('tsconfig.json must set "tsBuildInfoFile": "./dist/tsconfig.tsbuildinfo"');
  const backendDir = path.resolve(pluginDir, '..', '..', 'packages', 'backend');
  const refsBackend = (tsconfig.references || []).some((r) => path.resolve(pluginDir, r.path) === backendDir);
  if (!refsBackend) errors.push('tsconfig.json must reference "../../packages/backend" in "references"');
  return errors;
}

function updateDevSolution(plugins) {
  const solutionPath = path.join(rootDir, DEV_SOLUTION_FILE);
  const content = generateDevSolutionContent(plugins);
  if (isDryRun) {
    log(`[dry-run] Would write ${solutionPath}`);
    verbose(content);
  } else {
    fs.writeFileSync(solutionPath, content);
    log(`Updated dev solution at ${solutionPath}`);
  }
}

const WEB_REGISTRY_HEADER = '// Auto-generated by scripts/generate-registry.js';

/**
 * Web-side registry, split into three modules so that importing menus (sidebar) or
 * dictionaries (root layout) does not pull every plugin's pages into every route.
 * Plugin pages are loaded lazily, per plugin, by the [slug] routes.
 */
function generateWebRegistryFiles(plugins) {
  const menuPlugins = plugins.filter(p => p.hasWebMenus);
  const dictPlugins = plugins.filter(p => p.hasDictionaries);

  const menus = [
    WEB_REGISTRY_HEADER,
    `import type { NavigationItem } from '../config/navigation';`,
    ...menuPlugins.map(p => `import { ${p.pascalName}Menus } from '${p.pkgName}/menus';`),
    '',
    menuPlugins.length > 0
      ? `export const PluginMenus: Record<string, NavigationItem[]> = {\n  ${menuPlugins.map(p => `'${p.dirName}': ${p.pascalName}Menus`).join(',\n  ')}\n};`
      : `export const PluginMenus: Record<string, NavigationItem[]> = {};`,
    '',
  ].join('\n');

  const dictionaries = [
    WEB_REGISTRY_HEADER,
    `import type { Dictionaries } from '@saas/ui';`,
    ...dictPlugins.map(p => `import { ${toCamelCase(p.pascalName)}Dictionaries } from '${p.pkgName}/dictionaries';`),
    '',
    dictPlugins.length > 0
      ? `export const PluginDictionaries: Dictionaries[] = [\n  ${dictPlugins.map(p => `${toCamelCase(p.pascalName)}Dictionaries`).join(',\n  ')}\n];`
      : `export const PluginDictionaries: Dictionaries[] = [];`,
    '',
  ].join('\n');

  const routes = [
    WEB_REGISTRY_HEADER,
    `import type { PluginComponent } from './plugin-types';`,
    '',
    plugins.length > 0
      ? `export const PluginRouteLoaders: Record<string, () => Promise<Record<string, PluginComponent>>> = {\n  ${plugins.map(p => `'${p.dirName}': () => import('${p.pkgName}/web').then((m) => m.${p.pascalName}Routes)`).join(',\n  ')}\n};`
      : `export const PluginRouteLoaders: Record<string, () => Promise<Record<string, PluginComponent>>> = {};`,
    '',
  ].join('\n');

  return { 'plugin-menus.ts': menus, 'plugin-dictionaries.ts': dictionaries, 'plugin-routes.ts': routes };
}

function updateWebRegistry(plugins) {
  const libDir = path.join(webDir, 'lib');
  if (!fs.existsSync(libDir)) {
    fs.mkdirSync(libDir, { recursive: true });
  }

  const files = generateWebRegistryFiles(plugins);
  for (const [fileName, content] of Object.entries(files)) {
    const filePath = path.join(libDir, fileName);
    if (isDryRun) {
      log(`[dry-run] Would write Web registry module ${filePath}`);
      verbose(content);
    } else {
      fs.writeFileSync(filePath, content);
      log(`Updated Web registry module at ${filePath}`);
    }
  }

  // The combined registry statically imported every plugin's pages; it is replaced by the modules above.
  const legacyRegistryPath = path.join(libDir, 'plugin-registry.ts');
  if (fs.existsSync(legacyRegistryPath) && !isDryRun) {
    fs.unlinkSync(legacyRegistryPath);
    log(`Removed legacy ${legacyRegistryPath}`);
  }

  // Generate plugin-layout-config.ts
  const layoutConfigPath = path.join(libDir, 'plugin-layout-config.ts');
  const layoutEntries = plugins.map(p => {
    const layout = p.manifest?.layout || 'console';
    return `  '${p.dirName}': '${layout}'`;
  });
  const layoutContent = [
    '// Auto-generated by scripts/generate-registry.js',
    'export const pluginLayoutConfig: Record<string, string> = {',
    layoutEntries.join(',\n'),
    '};',
    '',
  ].join('\n');

  if (!isDryRun) {
    fs.writeFileSync(layoutConfigPath, layoutContent);
    log(`Updated plugin layout config at ${layoutConfigPath}`);
  }

  return files;
}

function updateTailwindSources(plugins) {
  const globalsPath = path.join(webDir, 'app/globals.css');

  if (!fs.existsSync(globalsPath)) {
    warn('globals.css not found, skipping Tailwind source update');
    return;
  }

  let content = fs.readFileSync(globalsPath, 'utf-8');

  // Remove existing plugin @source lines
  content = content.replace(/\n@source "\.\.\/\.\.\/\.\.\/plugins\/[^"]+";/g, '');

  // Build new plugin @source lines
  const pluginSources = plugins
    .map(p => `@source "../../../plugins/${p.dirName}/src/web";`)
    .join('\n');

  // Insert after the @source "../../../packages/ui"; line
  const anchorRegex = /(@source "\.\.\/\.\.\/\.\.\/packages\/ui";)/;
  if (anchorRegex.test(content)) {
    content = content.replace(anchorRegex, `$1\n${pluginSources}`);
  } else {
    // Fallback: insert after the @import "tailwindcss"; line
    const fallbackRegex = /(@import "tailwindcss";)/;
    if (fallbackRegex.test(content)) {
      content = content.replace(fallbackRegex, `$1\n${pluginSources}`);
      warn('Inserted plugin @source directives after @import (anchor @source packages/ui line missing)');
    } else {
      warn('Could not find insertion point for plugin @source directives in globals.css');
      return;
    }
  }

  if (isDryRun) {
    log(`[dry-run] Would update Tailwind sources in ${globalsPath}`);
  } else {
    fs.writeFileSync(globalsPath, content);
    log(`Updated Tailwind sources in ${globalsPath}`);
  }
}

function updateNextConfig(plugins) {
  const nextConfigPath = path.join(webDir, 'next.config.js');
  if (!fs.existsSync(nextConfigPath)) {
    warn('next.config.js not found, skipping transpilePackages update');
    return;
  }

  let content = fs.readFileSync(nextConfigPath, 'utf-8');
  const pluginPackages = plugins.map(p => `'${p.pkgName}'`).join(', ');
  const newTranspile = `transpilePackages: [${pluginPackages}]`;

  const transpileRegex = /transpilePackages:\s*\[[^\]]*\]/;
  if (transpileRegex.test(content)) {
    content = content.replace(transpileRegex, newTranspile);
  } else {
    warn('Could not find transpilePackages in next.config.js. Please update manually.');
    return;
  }

  if (isDryRun) {
    log(`[dry-run] Would update transpilePackages in ${nextConfigPath}`);
  } else {
    fs.writeFileSync(nextConfigPath, content);
    log(`Updated transpilePackages in ${nextConfigPath}`);
  }
}

function updateApiTsConfigPaths(plugins) {
  const tsconfigPath = path.join(apiDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    warn('apps/api/tsconfig.json not found, skipping paths update');
    return;
  }

  const raw = fs.readFileSync(tsconfigPath, 'utf-8');
  const tsconfig = JSON.parse(raw);

  if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
  const existingPaths = tsconfig.compilerOptions.paths || {};

  // Strip existing plugin path entries; preserve everything else (e.g. @saas/database, custom paths)
  const pluginPkgNames = new Set(plugins.map(p => p.pkgName));
  const preserved = {};
  for (const [key, value] of Object.entries(existingPaths)) {
    const m = key.match(/^(@saas\/[^\/]+)(?:\/.*)?$/);
    if (m && pluginPkgNames.has(m[1])) continue;
    preserved[key] = value;
  }

  // Rebuild plugin path entries
  const pluginPaths = {};
  for (const p of plugins) {
    pluginPaths[p.pkgName] = [`../../plugins/${p.dirName}/src`];
    if (p.hasConfigSchema) {
      // Work around config-schema (kebab) vs config.schema (dot filename) mismatch
      pluginPaths[`${p.pkgName}/config-schema`] = [`../../plugins/${p.dirName}/src/config.schema`];
    }
    pluginPaths[`${p.pkgName}/*`] = [`../../plugins/${p.dirName}/src/*`];
  }

  tsconfig.compilerOptions.paths = { ...preserved, ...pluginPaths };

  const newContent = JSON.stringify(tsconfig, null, 2) + (raw.endsWith('\n') ? '\n' : '');

  if (raw === newContent) {
    verbose(`No tsconfig.json changes for ${tsconfigPath}`);
    return;
  }

  if (isDryRun) {
    log(`[dry-run] Would update paths in ${tsconfigPath}`);
  } else {
    fs.writeFileSync(tsconfigPath, newContent);
    log(`Updated paths in ${tsconfigPath}`);
  }
}

// Non-plugin workspace packages that should never be removed
const CORE_PACKAGES = new Set(['@saas/ui', '@saas/backend', '@saas/database']);

function updatePackageJson(appDir, plugins) {
  const pkgPath = path.join(appDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  const added = [];
  const removed = [];

  if (!pkg.dependencies) {
    pkg.dependencies = {};
  }

  // Remove stale plugin dependencies
  const pluginPkgNames = new Set(plugins.map(p => p.pkgName));
  for (const dep of Object.keys(pkg.dependencies)) {
    if (dep.startsWith('@saas/') && !CORE_PACKAGES.has(dep) && !pluginPkgNames.has(dep)) {
      verbose(`Removing stale dependency: ${dep}`);
      delete pkg.dependencies[dep];
      removed.push(dep);
    }
  }

  // Add new plugin dependencies
  plugins.forEach(p => {
    if (!pkg.dependencies[p.pkgName]) {
      pkg.dependencies[p.pkgName] = "workspace:*";
      added.push(p.pkgName);
    }
  });

  const changed = added.length > 0 || removed.length > 0;

  if (changed) {
    if (isDryRun) {
      log(`[dry-run] Would update dependencies in ${pkgPath}`);
    } else {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      log(`Updated dependencies in ${pkgPath}`);
    }
  } else {
    verbose(`No dependency changes for ${pkgPath}`);
  }

  return { added, removed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  if (isDryRun) log('[dry-run mode] No files will be written.\n');
  if (isCheckMode) log('[check mode] Verifying registries are up to date.\n');
  if (isIncremental) log('[incremental mode] Using cache for unchanged plugins.\n');

  log('Scanning for plugins...');
  const plugins = getPlugins();
  log(`Found ${plugins.length} plugin(s): ${plugins.map(p => p.dirName).join(', ')}`);

  // Incremental: compute and log hashes
  if (isIncremental && plugins.length > 0) {
    const cache = loadCache();
    let unchanged = 0;
    const newCache = {};
    for (const p of plugins) {
      const pluginPath = path.join(pluginsDir, p.dirName);
      const hash = computePluginHash(pluginPath);
      newCache[p.dirName] = hash;
      if (cache[p.dirName] === hash) {
        verbose(`Plugin "${p.dirName}": unchanged (cache hit)`);
        unchanged++;
      } else {
        verbose(`Plugin "${p.dirName}": changed (cache miss)`);
      }
    }
    if (unchanged === plugins.length) {
      log('All plugins unchanged — registry files still regenerated for consistency.');
    } else {
      log(`${plugins.length - unchanged} plugin(s) changed, ${unchanged} unchanged.`);
    }
    // Save cache after successful generation (at end of function)
    // Store for later saving
    plugins._incrementalCache = newCache;
  }

  log('');

  // --check mode: compare generated content against files on disk
  if (isCheckMode) {
    const apiRegistryPath = path.join(apiDir, 'src/plugin-registry.ts');

    // Generate expected content without writing
    const expectedApi = generateApiRegistryContent(plugins);
    const expectedWeb = generateWebRegistryFiles(plugins);

    let outOfDate = false;
    const filesToCheck = [
      [apiRegistryPath, expectedApi],
      ...Object.entries(expectedWeb).map(([fileName, content]) => [path.join(webDir, 'lib', fileName), content]),
      [path.join(rootDir, DEV_SOLUTION_FILE), generateDevSolutionContent(plugins)],
    ];

    for (const [filePath, expectedContent] of filesToCheck) {
      const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
      if (current !== expectedContent) {
        error(`Out of date: ${path.relative(rootDir, filePath)}`);
        outOfDate = true;
      } else {
        verbose(`Up to date: ${path.relative(rootDir, filePath)}`);
      }
    }

    if (outOfDate) {
      log('');
      error('Plugin registries are out of date. Run: pnpm plugins:register');
      process.exit(1);
    } else {
      log('Plugin registries are up to date.');
    }
    return;
  }

  // Try to merge Prisma schema fragments
  let prismaMerged = false;
  try {
    const merger = require('./merge-prisma-schemas');
    if (merger && typeof merger.merge === 'function') {
      if (!isDryRun) {
        merger.merge();
        log('Prisma schemas merged from plugins.');
        prismaMerged = true;
      } else {
        log('[dry-run] Would merge Prisma schemas from plugins.');
      }
    }
  } catch (err) {
    console.error('');
    console.error('  +------------------------------------------------------+');
    console.error('  |  WARNING: Prisma schema merge failed!                 |');
    console.error('  |  Plugin database models may be missing.               |');
    console.error('  +------------------------------------------------------+');
    console.error(`  Reason: ${err.message || err}`);
    console.error('  Fix: Check your fragment.prisma files for syntax errors.');
    console.error('');
  }

  updateApiRegistry(plugins);
  updateWebRegistry(plugins);
  updateDevSolution(plugins);
  updateTailwindSources(plugins);
  updateNextConfig(plugins);
  updateApiTsConfigPaths(plugins);

  const apiDeps = updatePackageJson(apiDir, plugins);
  const webDeps = updatePackageJson(webDir, plugins);

  // Change summary (#7)
  const allAdded = [...new Set([...apiDeps.added, ...webDeps.added])];
  const allRemoved = [...new Set([...apiDeps.removed, ...webDeps.removed])];

  log('');
  log('Summary:');
  log(`  Plugins: ${plugins.length} registered (${plugins.map(p => p.dirName).join(', ')})`);
  if (allAdded.length > 0) log(`  Dependencies added: ${allAdded.join(', ')}`);
  if (allRemoved.length > 0) log(`  Dependencies removed: ${allRemoved.join(', ')}`);
  log(`  Tailwind sources: ${plugins.length} plugin(s) configured`);
  if (prismaMerged) log(`  Prisma schemas: merged`);

  // Save incremental cache
  if (isIncremental && !isDryRun && plugins._incrementalCache) {
    saveCache(plugins._incrementalCache);
    verbose('Saved plugin hash cache.');
  }

  log('');
  if (isDryRun) {
    log('Dry run complete. No files were modified.');
  } else {
    if (allAdded.length > 0 || allRemoved.length > 0) {
      log('Done. Please run "pnpm install" to update lockfile.');
    } else {
      log('Done.');
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateWebRegistryFiles, generateDevSolutionContent, validatePluginTsconfig };
