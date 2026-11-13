const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// Written by the dev watcher (scripts/dev-watch.js) at the end of every tsc build cycle
// in which backend/plugin output the API can load changed.
const DEV_BUILD_STAMP = path.join(ROOT, '.dev-watch', 'api-reload.stamp');

// Nest's webpack setup externalizes every node_modules package, including the
// @saas/* workspace packages (backend + plugins), which are loaded from their `dist`
// at runtime, so webpack never sees those files change. Rather than watching the
// dist folders (tsc re-emits them project by project, which would restart the API
// several times per change, possibly on a half-written dist), watch the dev
// watcher's stamp file: one restart per completed build cycle. A missing stamp
// (fresh clone) is watched as a missing dependency.
class WatchDevBuildStamp {
  constructor({ stampPath = DEV_BUILD_STAMP } = {}) {
    this.stampPath = stampPath;
  }

  apply(compiler) {
    compiler.hooks.afterCompile.tap('WatchDevBuildStamp', (compilation) => {
      if (fs.existsSync(this.stampPath)) compilation.fileDependencies.add(this.stampPath);
      else compilation.missingDependencies.add(this.stampPath);
    });
  }
}

module.exports = function (options) {
  return {
    ...options,
    plugins: [...(options.plugins || []), new WatchDevBuildStamp()],
    watchOptions: {
      ...options.watchOptions,
      ignored: /node_modules/,
    },
  };
};

module.exports.DEV_BUILD_STAMP = DEV_BUILD_STAMP;
module.exports.WatchDevBuildStamp = WatchDevBuildStamp;
