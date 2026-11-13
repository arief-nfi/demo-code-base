import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContextService } from '../utils/request-context.service';

/**
 * Interceptor to set request context with authenticated user information.
 * This runs AFTER guards (including JwtAuthGuard), so req.user is available.
 * Uses AsyncLocalStorage for per-request scoping — no race conditions.
 *
 * Also enforces tenant ownership: if the authenticated user's tenantId
 * doesn't match the x-tenant-id header, the request is rejected.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestContextInterceptor.name);

  constructor(
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set by JwtAuthGuard
    const tenantId = request.headers['x-tenant-id'];
    const tenant = request.tenant; // Set by TenancyMiddleware

    const userId = user?.userId || user?.sub || user?.id;

    // Tenant ownership verification: if the user is authenticated AND a tenant
    // was resolved from the header, verify they match. This prevents a user
    // from tenant A sending x-tenant-id for tenant B to access their data.
    if (user?.tenantId && tenant?.id && user.tenantId !== tenant.id) {
      this.logger.warn(
        `Tenant mismatch: user ${userId} belongs to tenant ${user.tenantId} but requested tenant ${tenant.id}`,
      );
      throw new ForbiddenException('Access denied: tenant mismatch');
    }

    // Get real IP address (handle proxies)
    const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               request.headers['x-real-ip'] ||
               request.connection?.remoteAddress ||
               request.ip;

    const requestContextData = {
      userId,
      tenantId: tenant?.id || tenantId,
      tenantSlug: tenant?.slug || user?.tenantSlug,
      url: request.url || request.originalUrl,
      method: request.method,
      ip,
      userAgent: request.headers['user-agent'],
    };

    // Run the handler within the AsyncLocalStorage context scope
    return new Observable((subscriber) => {
      this.requestContext.run(requestContextData, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
