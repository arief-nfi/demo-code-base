import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AUDIT_METADATA_KEY } from './audit.decorator';
import type { AuditOptions } from './audit.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMeta = this.reflector.get<AuditOptions>(
      AUDIT_METADATA_KEY,
      context.getHandler(),
    );

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap((responseBody) => {
        this.logAudit(auditMeta, request, responseBody).catch((err) => {
          this.logger.error(
            `Failed to log audit for ${auditMeta.entity}`,
            err instanceof Error ? err.stack : String(err),
          );
        });
      }),
    );
  }

  private async logAudit(
    meta: AuditOptions,
    request: any,
    responseBody: unknown,
  ): Promise<void> {
    const entityId =
      meta.entityId ??
      request.params?.id ??
      this.extractIdFromResponse(responseBody) ??
      'list';

    const user = request.user;
    const userId = user?.userId ?? user?.sub ?? user?.id;
    const tenantSlug = request.tenant?.slug ?? user?.tenantSlug;

    const ip =
      request.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ??
      request.headers?.['x-real-ip'] ??
      request.connection?.remoteAddress ??
      request.ip;

    await this.auditService.log({
      action: meta.action ?? 'READ',
      entity: meta.entity,
      entityId: String(entityId),
      userId,
      tenantSlug,
      metadata: {
        requestUrl: request.url ?? request.originalUrl,
        requestMethod: request.method,
        requestIp: ip,
        userAgent: request.headers?.['user-agent'],
      },
    });
  }

  /**
   * Attempt to extract an 'id' field from the response body.
   * Returns undefined if the response is not a plain object with an 'id'.
   */
  private extractIdFromResponse(body: unknown): string | undefined {
    if (
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      'id' in body
    ) {
      const id = (body as Record<string, unknown>).id;
      return id !== null && id !== undefined ? String(id) : undefined;
    }
    return undefined;
  }
}
