const path = require('path');
const { loadRootPublicEnv } = require('./load-root-env');

// NEXT_PUBLIC_* settings live in the repo-root .env with everything else (an apps/web/.env*.local still overrides)
loadRootPublicEnv(path.join(__dirname, '../..'));

function buildRemotePatterns() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  try {
    const url = new URL(apiUrl);
    return [{
      protocol: url.protocol.replace(':', ''),
      hostname: url.hostname,
      port: url.port || '',
      pathname: '/uploads/**',
    }];
  } catch {
    return [{ protocol: 'http', hostname: 'localhost', port: '3001', pathname: '/uploads/**' }];
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
  experimental: {
    authInterrupts: true,
  },
  devIndicators: {
    position: 'bottom-right',
  },
  turbopack: {
    root: path.join(__dirname, '../../'),
    resolveAlias: {
      // One sonner for the whole bundle: plugins and @saas/ui resolve their own copies
      // (other versions / peer variants), whose toasts never reach the app's <Toaster>.
      sonner: './node_modules/sonner',
    },
  },
  images: {
    remotePatterns: buildRemotePatterns(),
  },
  transpilePackages: ['@saas/plugin-audit-log', '@saas/plugin-document-templates', '@saas/plugin-integration', '@saas/sample-plugin'],
};

module.exports = nextConfig;
