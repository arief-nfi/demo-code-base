import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { PLUGIN_KEY_METADATA } from './plugin-key.decorator';
import { PluginMetricsService } from './plugin-metrics.service';

@Injectable()
export class PluginMetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly metrics: PluginMetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const pluginKey = this.reflector.get<string>(PLUGIN_KEY_METADATA, context.getClass());
    if (!pluginKey) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const method = request.method ?? 'UNKNOWN';
    const url = request.url ?? request.path ?? '/';
    const operation = `${method} ${url}`;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.metrics.record(pluginKey, operation, Date.now() - start);
      }),
      catchError((error) => {
        this.metrics.record(pluginKey, operation, Date.now() - start, error);
        return throwError(() => error);
      }),
    );
  }
}
