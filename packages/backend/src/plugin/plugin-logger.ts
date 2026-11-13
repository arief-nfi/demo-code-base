import type { Logger } from '@nestjs/common';

export function pluginLogger(logger: Logger, pluginKey: string, tenantSlug: string) {
  const prefix = `[plugin:${pluginKey}][tenant:${tenantSlug}]`;
  return {
    log: (msg: string) => logger.log(`${prefix} ${msg}`),
    warn: (msg: string) => logger.warn(`${prefix} ${msg}`),
    error: (msg: string) => logger.error(`${prefix} ${msg}`),
    debug: (msg: string) => logger.debug?.(`${prefix} ${msg}`),
  };
}
