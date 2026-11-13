import { z } from 'zod';

/** Used when .env leaves DEFAULT_ADMIN_PASSWORD unset. It is in the source, so production refuses it (seedAdminPassword) */
const DEFAULT_ADMIN_PASSWORD_FALLBACK = 'S3cr3T!!';

export const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Server
  PORT: z.coerce.number().default(3001),
  // Swagger UI — enable to expose interactive API docs at SWAGGER_PATH (default '/').
  // Disable in production to avoid leaking endpoint shapes.
  SWAGGER_ENABLED: z.enum(['true', 'false']).default('true'),
  SWAGGER_PATH: z.string().default('/'),

  // Helmet security headers — both default to enabled (recommended).
  // Disable when embedding in iframes (frameguard) or running Swagger UI which
  // needs inline scripts (contentSecurityPolicy).
  HELMET_FRAMEGUARD: z.enum(['true', 'false']).default('true'),
  HELMET_CSP: z.enum(['true', 'false']).default('true'),
  // Comma-separated list of allowed origins. Supports '*' (reflect any),
  // exact URLs (https://app.example.com), or wildcard patterns (https://*.coder.example.com).
  CORS_ORIGINS: z.string().default('*'),
  // Express 'trust proxy' — required when running behind nginx/Coder/etc. so
  // req.secure / req.protocol reflect the original HTTPS connection.
  // Accepts: 'true' | 'false' | a number of hops | a CIDR/IP list.
  TRUST_PROXY: z.string().default('false'),

  // Cookies
  // COOKIE_SECURE: 'auto' = secure when NODE_ENV=production (set to 'true' when behind an HTTPS proxy like nginx)
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  COOKIE_DOMAIN: z.string().optional(),
  // Cookie paths. Default to '/' for both — narrowing the refresh token's path
  // (e.g. '/auth/refresh') is more secure but breaks behind some reverse proxies
  // that rewrite paths or with browsers that reject more-specific Path attributes.
  ACCESS_COOKIE_PATH: z.string().default('/'),
  REFRESH_COOKIE_PATH: z.string().default('/'),

  // JWT
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('24h'), // Legacy — use JWT_ACCESS_EXPIRES_IN instead
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Bcrypt
  BCRYPT_SALT_ROUNDS: z.coerce.number().min(4).max(20).default(10),

  // Uploads
  UPLOAD_DIR: z.string().default('uploads'),

  // Webhooks — allow outbound webhook URLs that target localhost / private
  // networks (read by the integration plugin). Local development only: in
  // production this re-opens SSRF against internal services.
  ALLOW_PRIVATE_WEBHOOK_URLS: z.enum(['true', 'false']).default('false'),

  // Frontend URL
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // The password `pnpm db:seed` gives the System workspace's admin (admin@system)
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).default(DEFAULT_ADMIN_PASSWORD_FALLBACK),

  // Password reset
  PASSWORD_RESET_EXPIRES_MS: z.coerce.number().default(3600000), // 1 hour

  // Rate Limiting
  THROTTLE_TTL_SECONDS: z.coerce.number().default(60),
  THROTTLE_LIMIT: z.coerce.number().default(100),
  THROTTLE_AUTH_TTL_SECONDS: z.coerce.number().default(60),
  THROTTLE_AUTH_LIMIT: z.coerce.number().default(5),

  // Database pooling
  DB_POOL_SIZE: z.coerce.number().default(5),
  DB_POOL_TIMEOUT: z.coerce.number().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().default(300000), // 5 minutes
  MAX_TENANT_CLIENTS: z.coerce.number().min(1).default(50),

  // Redis (optional — in-memory cache used when not configured)
  REDIS_URL: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Mail (optional — mail may not be configured in dev)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_FROM_NAME: z.string().optional(),
  SALES_EMAIL: z.string().optional(),
  // Public base URL of this API — makes tenant logo URLs in emails absolute
  API_PUBLIC_URL: z.string().default('http://localhost:3001'),
  EMAIL_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),

  // Google Calendar integration (Integration plugin); any unset → "not configured"
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // 32 bytes, base64 (openssl rand -base64 32): encrypts stored OAuth refresh tokens
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),

  // Plugin billing — no default provider: unset means paid plugins can't be bought
  BILLING_PROVIDER: z.string().optional(),
  BILLING_CALLBACK_TOKEN: z.string().optional(),
  BILLING_FAKE_ALLOWED: z.enum(['true', 'false']).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }
  return result.data;
}

/**
 * The password `pnpm db:seed` gives admin@system: DEFAULT_ADMIN_PASSWORD. In production the built-in
 * fallback is refused: anyone who reads the source could sign in as the sysadmin.
 */
export function seedAdminPassword(password: string, nodeEnv: string | undefined): string {
  if (nodeEnv === 'production' && password === DEFAULT_ADMIN_PASSWORD_FALLBACK) {
    throw new Error('Set DEFAULT_ADMIN_PASSWORD in .env: production does not accept the built-in default admin password');
  }
  return password;
}
