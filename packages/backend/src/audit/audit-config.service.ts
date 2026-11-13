import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  AUDIT_SENSITIVE_FIELDS,
  AUDIT_IGNORED_FIELDS,
  DEFAULT_AUDIT_FILTER,
  DEFAULT_RETENTION_POLICY,
  StoredEntityFilter,
  toAuditFilterConfig,
  AuditFilterConfig,
  AuditRetentionPolicy,
} from './audit.config';

export interface AuditFieldConfig {
  sensitiveFields: Record<string, string[]>;
  ignoredFields: Record<string, string[]>;
  entityFilter: StoredEntityFilter | null;
  retentionPolicy: AuditRetentionPolicy | null;
}

const CACHE_TTL_MS = 3_600_000; // 1 hour

@Injectable()
export class AuditConfigService {
  private readonly logger = new Logger(AuditConfigService.name);

  /**
   * Local in-process cache for synchronous readers (getSensitiveFields, etc.).
   * Populated by getConfig() and ensureLoaded(). This is needed because
   * Prisma middleware calls these synchronously in the hot path.
   */
  private readonly localCache = new Map<string, AuditFieldConfig>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Get the audit field config for a tenant.
   * Reads from shared cache (Redis/memory), falls back to DB.
   * If no DB record exists, returns the hardcoded defaults.
   */
  async getConfig(tenantSlug: string): Promise<AuditFieldConfig> {
    const cacheKey = `audit:config:${tenantSlug}`;

    // Check shared cache first
    const cached = await this.cache.get<AuditFieldConfig>(cacheKey);
    if (cached) {
      this.localCache.set(tenantSlug, cached);
      return cached;
    }

    try {
      const client = this.prisma.getTenantClient(tenantSlug);
      const record = await client.auditConfig.findFirst();

      const config: AuditFieldConfig = {
        sensitiveFields: record?.sensitiveFields
          ? (record.sensitiveFields as Record<string, string[]>)
          : { ...AUDIT_SENSITIVE_FIELDS },
        ignoredFields: record?.ignoredFields
          ? (record.ignoredFields as Record<string, string[]>)
          : { ...AUDIT_IGNORED_FIELDS },
        entityFilter: record?.entityFilter
          ? (record.entityFilter as unknown as StoredEntityFilter)
          : null,
        retentionPolicy: record?.retentionPolicy
          ? (record.retentionPolicy as unknown as AuditRetentionPolicy)
          : null,
      };

      await this.cache.set(cacheKey, config, CACHE_TTL_MS);
      this.localCache.set(tenantSlug, config);
      return config;
    } catch (error) {
      this.logger.warn(
        `Failed to load audit config for tenant ${tenantSlug}, using defaults: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        sensitiveFields: { ...AUDIT_SENSITIVE_FIELDS },
        ignoredFields: { ...AUDIT_IGNORED_FIELDS },
        entityFilter: null,
        retentionPolicy: null,
      };
    }
  }

  /**
   * Save audit field config for a tenant.
   * Uses upsert — creates a new record if none exists, updates otherwise.
   */
  async saveConfig(tenantSlug: string, dto: Partial<AuditFieldConfig>): Promise<AuditFieldConfig> {
    const client = this.prisma.getTenantClient(tenantSlug);
    const existing = await client.auditConfig.findFirst();

    const data: Record<string, unknown> = {};
    if (dto.sensitiveFields !== undefined) data.sensitiveFields = dto.sensitiveFields;
    if (dto.ignoredFields !== undefined) data.ignoredFields = dto.ignoredFields;
    if (dto.entityFilter !== undefined) data.entityFilter = dto.entityFilter;
    if (dto.retentionPolicy !== undefined) data.retentionPolicy = dto.retentionPolicy;

    if (existing) {
      await client.auditConfig.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await client.auditConfig.create({ data });
    }

    // Invalidate shared cache and local cache
    await this.cache.del(`audit:config:${tenantSlug}`);
    this.localCache.delete(tenantSlug);

    return this.getConfig(tenantSlug);
  }

  /**
   * Synchronous read of sensitive fields config from local cache.
   * Falls back to hardcoded defaults if cache is empty.
   */
  getSensitiveFields(tenantSlug?: string): Record<string, string[]> {
    if (!tenantSlug) return AUDIT_SENSITIVE_FIELDS;
    const cached = this.localCache.get(tenantSlug);
    if (cached) return cached.sensitiveFields;
    return AUDIT_SENSITIVE_FIELDS;
  }

  /**
   * Synchronous read of ignored fields config from local cache.
   * Falls back to hardcoded defaults if cache is empty.
   */
  getIgnoredFields(tenantSlug?: string): Record<string, string[]> {
    if (!tenantSlug) return AUDIT_IGNORED_FIELDS;
    const cached = this.localCache.get(tenantSlug);
    if (cached) return cached.ignoredFields;
    return AUDIT_IGNORED_FIELDS;
  }

  /**
   * Synchronous read of entity filter config from local cache.
   * Returns the AuditFilterConfig for use in shouldAudit().
   * Falls back to DEFAULT_AUDIT_FILTER if cache is empty or not configured.
   */
  getEntityFilter(tenantSlug?: string): AuditFilterConfig {
    if (!tenantSlug) return DEFAULT_AUDIT_FILTER;
    const cached = this.localCache.get(tenantSlug);
    if (cached?.entityFilter) {
      return toAuditFilterConfig(cached.entityFilter);
    }
    return DEFAULT_AUDIT_FILTER;
  }

  /**
   * Synchronous read of retention policy from local cache.
   * Falls back to DEFAULT_RETENTION_POLICY if cache is empty or not configured.
   */
  getRetentionPolicy(tenantSlug?: string): AuditRetentionPolicy {
    if (!tenantSlug) return DEFAULT_RETENTION_POLICY;
    const cached = this.localCache.get(tenantSlug);
    if (cached?.retentionPolicy) {
      return cached.retentionPolicy;
    }
    return DEFAULT_RETENTION_POLICY;
  }

  /**
   * Preload config into cache for a tenant.
   * Called during tenant client initialization to ensure
   * synchronous reads are available in the middleware.
   */
  async ensureLoaded(tenantSlug: string): Promise<void> {
    await this.getConfig(tenantSlug);
  }
}
