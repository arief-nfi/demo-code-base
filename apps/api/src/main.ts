import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';

type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

function buildCorsOriginMatcher(corsOrigins: string) {
  if (corsOrigins === '*') return true;
  const entries = corsOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  const exact = new Set(entries.filter((e) => !e.includes('*')));
  const patterns = entries
    .filter((e) => e.includes('*'))
    .map((e) => new RegExp('^' + e.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));

  return (origin: string | undefined, callback: CorsOriginCallback) => {
    if (!origin) return callback(null, true); // non-browser tools (curl, server-to-server)
    if (exact.has(origin) || patterns.some((p) => p.test(origin))) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`), false);
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Parse cookies so req.cookies is available (needed for HttpOnly JWT cookie)
  app.use(cookieParser());

  // Trust reverse proxy headers (X-Forwarded-Proto, X-Forwarded-For, etc.)
  // Required when running behind nginx so secure cookies and req.protocol work.
  const trustProxy = configService.get<string>('TRUST_PROXY', 'false');
  if (trustProxy && trustProxy !== 'false') {
    const value = /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy;
    const httpAdapter = app.getHttpAdapter().getInstance();
    httpAdapter.set('trust proxy', value);
    logger.log(`Trust proxy enabled: ${value}`);
  }

  // Security headers
  const helmetFrameguard = configService.get<string>('HELMET_FRAMEGUARD', 'true') === 'true';
  const helmetCsp = configService.get<string>('HELMET_CSP', 'true') === 'true';
  app.use(helmet({
    frameguard: helmetFrameguard ? undefined : false,
    contentSecurityPolicy: helmetCsp ? undefined : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow serving uploads cross-origin
  }));
  logger.log(`Helmet: frameguard=${helmetFrameguard} contentSecurityPolicy=${helmetCsp}`);

  const corsOrigins = configService.get<string>('CORS_ORIGINS', '*');
  if (corsOrigins === '*' && process.env.NODE_ENV === 'production') {
    logger.warn('CORS_ORIGINS is set to "*" in production. This is a security risk. Set specific origins instead.');
  }
  app.enableCors({
    origin: buildCorsOriginMatcher(corsOrigins),
    credentials: true,
  });
  logger.log(`CORS origins: ${corsOrigins}`);
  logger.log(
    `Cookie config: secure=${configService.get('COOKIE_SECURE', 'auto')} ` +
    `sameSite=${configService.get('COOKIE_SAME_SITE', 'strict')} ` +
    `accessPath=${configService.get('ACCESS_COOKIE_PATH', '/')} ` +
    `refreshPath=${configService.get('REFRESH_COOKIE_PATH', '/')} ` +
    `domain=${configService.get('COOKIE_DOMAIN', '(host)')}`,
  );
  app.enableShutdownHooks();

  const swaggerEnabled = configService.get<string>('SWAGGER_ENABLED', 'true') === 'true';
  const swaggerPath = configService.get<string>('SWAGGER_PATH', '/');
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('SaaS Multitenant API')
      .setDescription('The SaaS Multitenant API description')
      .setVersion('1.0')
      .addBearerAuth()
      .addGlobalParameters({
        name: 'x-tenant-id',
        in: 'header',
        description: 'Tenant ID for multi-tenancy',
        required: false,
      })
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(swaggerPath, app, document, {
      jsonDocumentUrl: '/openapi.json',
      yamlDocumentUrl: '/openapi.yaml',
    });
  }

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);

  logger.log(`Application is running on: ${await app.getUrl()}`);
  if (swaggerEnabled) {
    logger.log(`Swagger UI is available at: ${await app.getUrl()}${swaggerPath === '/' ? '' : swaggerPath}`);
  } else {
    logger.log('Swagger UI is disabled (set SWAGGER_ENABLED=true to enable)');
  }
}
bootstrap();
