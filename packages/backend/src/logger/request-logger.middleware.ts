import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const EXCLUDED_PATHS = ['/health', '/uploads/', '/api'];

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    // Skip excluded paths
    if (EXCLUDED_PATHS.some((p) => req.originalUrl.startsWith(p))) {
      return next();
    }

    // Generate and attach request ID
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    const startTime = Date.now();
    const { method, originalUrl } = req;
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      req.ip;
    const userAgent = req.headers['user-agent'] || '-';

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { statusCode } = res;
      const tenantSlug = (req as any).tenant?.slug || '-';
      const username = (req as any).user?.username || '-';

      const logData = {
        requestId,
        method,
        path: originalUrl,
        statusCode,
        duration: `${duration}ms`,
        tenantSlug,
        username,
        ip,
        userAgent,
      };

      const message = `${method} ${originalUrl} ${statusCode} ${duration}ms`;

      if (statusCode >= 500) {
        this.logger.error(message, JSON.stringify(logData));
      } else if (statusCode >= 400) {
        this.logger.warn(message, JSON.stringify(logData));
      } else {
        this.logger.log(message, JSON.stringify(logData));
      }
    });

    next();
  }
}
