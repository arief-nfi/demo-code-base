import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  userId?: string;
  tenantId?: string;
  tenantSlug?: string;
  url?: string;
  method?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Service to store and retrieve request context (user, tenant, etc.)
 * Uses AsyncLocalStorage for automatic per-request scoping with zero memory leak risk.
 */
@Injectable()
export class RequestContextService {
  private static storage = new AsyncLocalStorage<RequestContext>();

  /**
   * Run a callback within a request context scope.
   * The context is automatically cleaned up when the callback completes.
   */
  run<T>(context: RequestContext, callback: () => T): T {
    return RequestContextService.storage.run(context, callback);
  }

  /**
   * Get the current request context (returns undefined if called outside a run scope).
   */
  getStore(): RequestContext | undefined {
    return RequestContextService.storage.getStore();
  }

  /**
   * Static accessor for current context — usable outside NestJS DI (e.g., decorators).
   */
  static getCurrentContext(): RequestContext | undefined {
    return RequestContextService.storage.getStore();
  }
}
