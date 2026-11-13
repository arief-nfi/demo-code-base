import { Injectable, LoggerService as NestLoggerService, Scope } from '@nestjs/common';
import pino from 'pino';

export interface LogContext {
  requestId?: string;
  tenantSlug?: string;
  userId?: string;
  [key: string]: unknown;
}

@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService implements NestLoggerService {
  private logger: pino.Logger;
  private contextName = '';

  constructor() {
    const isProd = process.env.NODE_ENV === 'production';

    this.logger = pino({
      level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
      ...(isProd
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }),
    });
  }

  setContext(context: string): void {
    this.contextName = context;
  }

  log(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.info({ context: ctx || this.contextName, ...this.extractMeta(optionalParams) }, message);
  }

  error(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    const trace = typeof optionalParams[0] === 'string' ? optionalParams[0] : undefined;
    this.logger.error(
      { context: ctx || this.contextName, ...(trace ? { stack: trace } : {}), ...this.extractMeta(optionalParams) },
      message,
    );
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.warn({ context: ctx || this.contextName, ...this.extractMeta(optionalParams) }, message);
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.debug({ context: ctx || this.contextName, ...this.extractMeta(optionalParams) }, message);
  }

  verbose(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.trace({ context: ctx || this.contextName, ...this.extractMeta(optionalParams) }, message);
  }

  fatal(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.fatal({ context: ctx || this.contextName, ...this.extractMeta(optionalParams) }, message);
  }

  /** Get the underlying pino instance for advanced usage */
  getPinoInstance(): pino.Logger {
    return this.logger;
  }

  private extractContext(params: unknown[]): string | undefined {
    const last = params[params.length - 1];
    if (typeof last === 'string') {
      return last;
    }
    return undefined;
  }

  private extractMeta(params: unknown[]): Record<string, unknown> {
    for (const p of params) {
      if (p && typeof p === 'object' && !Array.isArray(p) && !(p instanceof Error)) {
        return p as Record<string, unknown>;
      }
    }
    return {};
  }
}
