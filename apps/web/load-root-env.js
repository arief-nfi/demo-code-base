const fs = require('fs');
const path = require('path');
const { parseEnv } = require('util');

/**
 * Copies the NEXT_PUBLIC_* values of the repo-root .env into `env`, so the web app is
 * configured from the same file as the API. A value that is already set wins: a real
 * environment variable, or an apps/web/.env*.local override (Next.js loads those before
 * next.config.js runs). Only NEXT_PUBLIC_* keys are copied: the root file also holds the
 * API's secrets, which the web server has no use for. Returns the keys it set.
 */
function loadRootPublicEnv(rootDir, env = process.env) {
  const file = path.join(rootDir, '.env');
  if (!fs.existsSync(file)) return [];
  const loaded = [];
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (!key.startsWith('NEXT_PUBLIC_') || env[key] !== undefined) continue;
    env[key] = value;
    loaded.push(key);
  }
  return loaded;
}

module.exports = { loadRootPublicEnv };
