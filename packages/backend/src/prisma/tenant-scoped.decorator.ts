import { Logger } from '@nestjs/common';
import { RequestContextService } from '../utils/request-context.service';

/**
 * Class decorator that validates tenant context exists before method execution.
 *
 * Apply to services that operate on tenant data. If a method is called
 * outside a tenant-scoped request (no tenantSlug in AsyncLocalStorage):
 * - Development: throws an error immediately (catches bugs early)
 * - Production: logs a warning (doesn't crash, but alerts)
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * @TenantScoped()
 * export class MyTenantService { ... }
 * ```
 */
export function TenantScoped(): ClassDecorator {
  return function (target: Function) {
    const logger = new Logger('TenantScoped');
    const methodNames = Object.getOwnPropertyNames(target.prototype).filter(
      (name) =>
        name !== 'constructor' &&
        typeof target.prototype[name] === 'function',
    );

    for (const methodName of methodNames) {
      const originalMethod = target.prototype[methodName];

      target.prototype[methodName] = function (...args: unknown[]) {
        const context = RequestContextService.getCurrentContext();
        if (!context?.tenantSlug) {
          const message = `${target.name}.${methodName}() called without tenant context. Ensure this service is only called from tenant-scoped requests.`;
          if (process.env.NODE_ENV !== 'production') {
            throw new Error(`[TenantScoped] ${message}`);
          } else {
            logger.warn(message);
          }
        }
        return originalMethod.apply(this, args);
      };
    }
  };
}
