import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Optional, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@saas/database';
import type { TenantPrismaClient } from './tenant-prisma-client';
import { AuditLogData } from '../audit/audit.service';
import { redactSensitiveFields, stripIgnoredFields, shouldAudit, DEFAULT_AUDIT_FILTER, AuditFilterConfig, BATCH_DETAIL_LIMIT, AUDIT_SENSITIVE_FIELDS, AUDIT_IGNORED_FIELDS } from '../audit/audit.config';
import type { AuditConfigService } from '../audit/audit-config.service';
import { RequestContextService } from '../utils/request-context.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private tenantClients = new Map<string, PrismaClient>();
  private tenantLastAccess = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private auditCallback?: (data: AuditLogData) => Promise<void>;
  private auditConfigService?: AuditConfigService;
  private maxTenantClients: number;

  constructor(
    private configService: ConfigService,
    @Optional() @Inject(RequestContextService) private requestContext?: RequestContextService,
  ) {
    super({
      datasources: {
        db: {
          url: configService.get('DATABASE_URL'),
        },
      },
    });
    this.maxTenantClients = configService.get<number>('MAX_TENANT_CLIENTS', 50);
  }

  /**
   * Register audit callback (called by AuditService)
   */
  setAuditCallback(callback: (data: AuditLogData) => Promise<void>) {
    this.auditCallback = callback;
  }

  /**
   * Register audit config service for per-tenant field config (called by AuditService)
   */
  setAuditConfigService(service: AuditConfigService) {
    this.auditConfigService = service;
  }

  /**
   * Get userId from current request context via AsyncLocalStorage
   */
  private getUserIdFromContext(): string | undefined {
    const context = this.requestContext?.getStore();
    return context?.userId;
  }

  /**
   * Get request metadata from current request context via AsyncLocalStorage
   */
  private getRequestMetadata(): Record<string, any> {
    const context = this.requestContext?.getStore();
    if (!context) {
      return {};
    }

    return {
      requestUrl: context.url,
      requestMethod: context.method,
      requestIp: context.ip,
      userAgent: context.userAgent,
    };
  }

  /**
   * Compare two relationship arrays/objects to check if they changed
   */
  private hasRelationshipChanged(oldValue: any, newValue: any): boolean {
    // Handle null/undefined cases
    if (!oldValue && !newValue) return false;
    if (!oldValue || !newValue) return true;

    // If both are arrays (one-to-many or many-to-many)
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      // Compare by length first
      if (oldValue.length !== newValue.length) return true;

      // Extract and sort IDs for comparison
      const oldIds = oldValue.map(item => item.id).sort();
      const newIds = newValue.map(item => item.id).sort();

      return JSON.stringify(oldIds) !== JSON.stringify(newIds);
    }

    // If both are objects (one-to-one)
    if (typeof oldValue === 'object' && typeof newValue === 'object') {
      return oldValue?.id !== newValue?.id;
    }

    // Fallback to JSON comparison
    return JSON.stringify(oldValue) !== JSON.stringify(newValue);
  }

  /**
   * Detect relationship fields in update data
   */
  private detectRelationshipFields(updateData: any): string[] {
    if (!updateData || typeof updateData !== 'object') {
      return [];
    }

    const relationFields: string[] = [];

    for (const [key, value] of Object.entries(updateData)) {
      // Check if this is a relationship operation
      if (value && typeof value === 'object') {
        const relationOps = ['connect', 'disconnect', 'set', 'create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany', 'upsert'];
        const hasRelationOp = relationOps.some(op => op in value);

        if (hasRelationOp) {
          relationFields.push(key);
        }
      }
    }

    return relationFields;
  }

  /**
   * Get all relationship fields for a model (for delete operations)
   * Uses the main client's DMMF since tenant clients may not have it
   */
  private getModelRelationships(modelName: string): string[] {
    try {
      // Use the main client's DMMF which is more reliable
      const prismaClient = this as any;

      // Try multiple ways to access DMMF based on Prisma version
      const dmmf = prismaClient._dmmf ||
                   prismaClient._baseDmmf ||
                   prismaClient._runtimeDataModel;

      if (!dmmf) {
        this.logger.warn('DMMF not found on PrismaClient');
        return this.getFallbackRelationships(modelName);
      }

      // Find the datamodel
      const datamodel = dmmf.datamodel || dmmf;

      if (!datamodel || !datamodel.models) {
        this.logger.warn('Datamodel or models not found in DMMF');
        return this.getFallbackRelationships(modelName);
      }

      const model = datamodel.models.find((m: any) => m.name === modelName);

      if (!model) {
        this.logger.warn(`Model ${modelName} not found in DMMF`);
        return this.getFallbackRelationships(modelName);
      }

      // Extract relationship fields (kind === 'object' means it's a relation)
      const relationFields = model.fields
        .filter((field: any) => field.kind === 'object')
        .map((field: any) => field.name);

      this.logger.debug(`Found ${relationFields.length} relationships for ${modelName}: ${relationFields.join(', ')}`);
      return relationFields;
    } catch (error) {
      this.logger.error(`Failed to introspect model relationships`, error instanceof Error ? error.stack : String(error));
      return this.getFallbackRelationships(modelName);
    }
  }

  /**
   * Fallback relationship mapping when DMMF is not available
   */
  private getFallbackRelationships(modelName: string): string[] {
    const relationshipMap: Record<string, string[]> = {
      'Role': ['users', 'permissions'],
      'User': ['roles', 'auditLogs'],
      'Permission': ['roles'],
      'Tenant': ['config'],
      'TenantConfig': ['tenant'],
      'AuditLog': ['user'],
    };

    const relationships = relationshipMap[modelName] || [];
    this.logger.debug(`Using fallback relationships for ${modelName}: ${relationships.join(', ')}`);
    return relationships;
  }

  /**
   * Convert PascalCase model name to camelCase for Prisma client delegate access
   */
  private toCamelCase(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  /**
   * Audit entity filter configuration — controls which models/actions are audited.
   */
  private auditFilter: AuditFilterConfig = DEFAULT_AUDIT_FILTER;

  /**
   * Configure which entities and actions are audited.
   */
  setAuditFilter(config: AuditFilterConfig) {
    if (config.include && config.exclude) {
      this.logger.warn('AuditFilterConfig: include and exclude are mutually exclusive — include takes precedence, exclude will be ignored');
    }
    this.auditFilter = config;
  }

  /**
   * Enable audit logging middleware
   */
  private enableAuditMiddleware(client: PrismaClient, tenantSlug?: string) {
    client.$use(async (params, next) => {
      // Determine if this operation should be audited
      const isWriteAction = ['create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany'].includes(params.action);
      const mappedAction = isWriteAction ? this.mapAction(params.action) : undefined;
      const shouldLog = isWriteAction
        && params.model
        && mappedAction !== 'READ'
        && shouldAudit(params.model, mappedAction!, this.auditConfigService?.getEntityFilter(tenantSlug) ?? this.auditFilter);

      // Fetch old record before update/delete operations
      let oldRecord: any = null;
      let relationFields: string[] = [];

      if (shouldLog && ['update', 'delete'].includes(params.action) && params.args?.where && params.model) {
        try {
          const modelDelegate = (client as any)[this.toCamelCase(params.model)];
          if (modelDelegate && modelDelegate.findUnique) {
            // Detect relationship fields
            if (params.action === 'update') {
              relationFields = this.detectRelationshipFields(params.args?.data);
            } else if (params.action === 'delete') {
              // For delete, get all relationships from the model
              relationFields = this.getModelRelationships(params.model);
            }

            // Build include object for relationships
            const include = relationFields.length > 0
              ? relationFields.reduce((acc, field) => {
                  acc[field] = true;
                  return acc;
                }, {} as Record<string, boolean>)
              : undefined;

            this.logger.debug(`Fetching old record for ${params.model}`);
            oldRecord = await modelDelegate.findUnique({
              where: params.args.where,
              ...(include && { include }),
            });
            this.logger.debug(`Old record fetched: ${oldRecord ? Object.keys(oldRecord).join(', ') : 'null'}`);
          }
        } catch (error) {
          // If we can't fetch the old record, continue without it
          this.logger.warn(`Failed to fetch old record for audit: ${error}`);
        }
      }

      // Pre-query for batch delete/update operations (need data before it's gone)
      let batchPreQueryRecords: any[] | null = null;

      if (shouldLog && ['deleteMany', 'updateMany'].includes(params.action) && params.model) {
        try {
          const modelDelegate = (client as any)[this.toCamelCase(params.model)];
          if (modelDelegate && modelDelegate.findMany) {
            if (params.action === 'deleteMany') {
              // For deleteMany: capture IDs of records about to be deleted
              batchPreQueryRecords = await modelDelegate.findMany({
                where: params.args?.where,
                select: { id: true },
              });
            } else if (params.action === 'updateMany') {
              // For updateMany: capture before-state of affected records
              // Select id + only the fields being changed (lightweight)
              const dataFields = params.args?.data
                ? Object.keys(params.args.data).reduce((acc: Record<string, boolean>, key: string) => {
                    acc[key] = true;
                    return acc;
                  }, { id: true } as Record<string, boolean>)
                : { id: true };

              batchPreQueryRecords = await modelDelegate.findMany({
                where: params.args?.where,
                select: dataFields,
              });
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to pre-query batch records for audit: ${error}`);
        }
      }

      const result = await next(params);

      // Fetch updated record with relationships for audit (after the operation)
      let updatedRecordWithRelations: any = result;
      if (shouldLog && params.action === 'update' && relationFields.length > 0 && params.args?.where && params.model) {
        try {
          const modelDelegate = (client as any)[this.toCamelCase(params.model)];
          if (modelDelegate && modelDelegate.findUnique) {
            const include = relationFields.reduce((acc, field) => {
              acc[field] = true;
              return acc;
            }, {} as Record<string, boolean>);

            updatedRecordWithRelations = await modelDelegate.findUnique({
              where: params.args.where,
              include,
            });
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch updated record with relations for audit: ${error}`);
        }
      }

      // Skip auditing if not applicable
      if (!shouldLog) {
        return result;
      }

      // Extract entity info
      const entity = params.model || 'Unknown';
      const action = mappedAction!;

      // For single operations
      if (['create', 'update', 'delete'].includes(params.action)) {
        const entityId = result?.id || params.args?.where?.id || 'unknown';
        const userId = this.getUserIdFromContext();
        const requestMetadata = this.getRequestMetadata();

        const changes = this.extractChanges(params.action, params.args, updatedRecordWithRelations || result, oldRecord, params.model, tenantSlug);

        // Skip audit if update only changed ignored fields (before & after both empty)
        if (params.action === 'update'
          && changes.before && changes.after
          && Object.keys(changes.before).length === 0
          && Object.keys(changes.after).length === 0) {
          return result;
        }

        const auditData: AuditLogData = {
          action,
          entity,
          entityId: String(entityId),
          userId,
          tenantSlug,
          changes,
          metadata: {
            operation: params.action,
            model: params.model,
            ...requestMetadata,
          },
        };

        this.queueAuditLog(auditData);
      }

      // For batch operations — capture detailed records
      if (['createMany', 'updateMany', 'deleteMany'].includes(params.action)) {
        const userId = this.getUserIdFromContext();
        const requestMetadata = this.getRequestMetadata();
        const batchSensitiveConfig = this.auditConfigService?.getSensitiveFields(tenantSlug) ?? AUDIT_SENSITIVE_FIELDS;
        const batchIgnoredConfig = this.auditConfigService?.getIgnoredFields(tenantSlug) ?? AUDIT_IGNORED_FIELDS;
        const redact = (data: any) =>
          data && typeof data === 'object' && params.model
            ? stripIgnoredFields(params.model!, redactSensitiveFields(params.model!, data, batchSensitiveConfig), batchIgnoredConfig)
            : data;

        const changes = this.buildBatchChanges(
          params.action,
          result,
          params.args,
          batchPreQueryRecords,
          redact,
        );

        const auditData: AuditLogData = {
          action,
          entity,
          entityId: 'batch',
          userId,
          tenantSlug: tenantSlug,
          changes,
          metadata: {
            operation: params.action,
            model: params.model,
            filter: params.args?.where,
            ...requestMetadata,
          },
        };

        this.queueAuditLog(auditData);
      }

      return result;
    });
  }

  private mapAction(prismaAction: string): 'CREATE' | 'UPDATE' | 'DELETE' | 'READ' {
    if (prismaAction.startsWith('create')) return 'CREATE';
    if (prismaAction.startsWith('update')) return 'UPDATE';
    if (prismaAction.startsWith('delete')) return 'DELETE';
    return 'READ';
  }

  private extractChanges(action: string, args: any, result: any, oldRecord?: any, model?: string, tenantSlug?: string) {
    const changes: any = {};
    const sensitiveConfig = this.auditConfigService?.getSensitiveFields(tenantSlug) ?? AUDIT_SENSITIVE_FIELDS;
    const ignoredConfig = this.auditConfigService?.getIgnoredFields(tenantSlug) ?? AUDIT_IGNORED_FIELDS;
    const redact = (data: any) =>
      data && typeof data === 'object' && model
        ? stripIgnoredFields(model, redactSensitiveFields(model, data, sensitiveConfig), ignoredConfig)
        : data;

    if (action === 'create') {
      // For create, show the created data
      changes.after = redact(result);
    } else if (action === 'update') {
      // For update, extract actual changes by comparing old and new values
      const updatedFields = args.data || {};
      const before: any = {};
      const after: any = {};

      // Map through the updated fields and extract before/after values
      Object.keys(updatedFields).forEach((key) => {
        const updateValue = updatedFields[key];

        // Handle relationship updates
        if (updateValue && typeof updateValue === 'object') {
          const relationOps = ['connect', 'disconnect', 'set', 'create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany', 'upsert'];
          const hasRelationOp = relationOps.some(op => op in updateValue);

          if (hasRelationOp) {
            // This is a relationship field - check if it actually changed
            const oldValue = oldRecord?.[key] || null;
            const newValue = result?.[key] || null;

            // Only include if the relationship actually changed
            if (this.hasRelationshipChanged(oldValue, newValue)) {
              before[key] = oldValue;
              after[key] = newValue;
            }
            return;
          }

          // Handle nested scalar updates (e.g., { set, increment, etc })
          if ('set' in updateValue) {
            const oldValue = oldRecord?.[key];
            const newValue = updateValue.set;
            // Only include if value actually changed
            if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
              before[key] = oldValue;
              after[key] = newValue;
            }
          } else if ('increment' in updateValue) {
            const oldValue = oldRecord?.[key];
            const newValue = oldValue ? oldValue + updateValue.increment : updateValue.increment;
            before[key] = oldValue;
            after[key] = newValue;
          } else if ('decrement' in updateValue) {
            const oldValue = oldRecord?.[key];
            const newValue = oldValue ? oldValue - updateValue.decrement : -updateValue.decrement;
            before[key] = oldValue;
            after[key] = newValue;
          } else {
            const oldValue = oldRecord?.[key];
            // Only include if value actually changed
            if (JSON.stringify(oldValue) !== JSON.stringify(updateValue)) {
              before[key] = oldValue;
              after[key] = updateValue;
            }
          }
        } else {
          // Simple scalar value update
          const oldValue = oldRecord?.[key];
          const newValue = updateValue;
          // Only include if value actually changed
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            before[key] = oldValue;
            after[key] = newValue;
          }
        }
      });

      changes.before = redact(before);
      changes.after = redact(after);
      changes.updated = redact(result); // Include the full updated record for reference
    } else if (action === 'delete') {
      // For delete, show what was deleted (use old record if available, otherwise result)
      const recordToUse = oldRecord || result;
      this.logger.debug(`Delete action - using ${oldRecord ? 'oldRecord' : 'result'} for before state`);
      changes.before = redact(recordToUse);
    }

    return changes;
  }

  /**
   * Build detailed changes payload for batch operations.
   *
   * - deleteMany: ids of deleted records (pre-queried)
   * - updateMany: before-state records + applied changes
   * - createMany: input data
   *
   * All lists are truncated to BATCH_DETAIL_LIMIT with a `truncated` flag.
   */
  private buildBatchChanges(
    action: string,
    result: any,
    args: any,
    preQueryRecords: any[] | null,
    redact: (data: any) => any,
  ): Record<string, any> {
    const count = result?.count || 0;

    if (action === 'deleteMany') {
      if (!preQueryRecords) {
        return { before: { count } };
      }
      const ids = preQueryRecords.map((r) => r.id);
      const truncated = ids.length > BATCH_DETAIL_LIMIT;
      return {
        before: {
          count,
          ids: truncated ? ids.slice(0, BATCH_DETAIL_LIMIT) : ids,
          ...(truncated && {
            truncated: true,
            truncatedMessage: `Showing first ${BATCH_DETAIL_LIMIT} of ${ids.length} records`,
          }),
        },
      };
    }

    if (action === 'updateMany') {
      const appliedChanges = args?.data ? redact(args.data) : {};
      if (!preQueryRecords) {
        return {
          after: { count, appliedChanges },
        };
      }
      const records = preQueryRecords.map((r) => redact(r));
      const truncated = records.length > BATCH_DETAIL_LIMIT;
      return {
        before: {
          records: truncated ? records.slice(0, BATCH_DETAIL_LIMIT) : records,
          ...(truncated && {
            truncated: true,
            truncatedMessage: `Showing first ${BATCH_DETAIL_LIMIT} of ${records.length} records`,
          }),
        },
        after: { count, appliedChanges },
      };
    }

    if (action === 'createMany') {
      const inputData: any[] = Array.isArray(args?.data) ? args.data : [];
      const redactedData = inputData.map((r) => redact(r));
      const truncated = redactedData.length > BATCH_DETAIL_LIMIT;
      return {
        after: {
          count,
          data: truncated ? redactedData.slice(0, BATCH_DETAIL_LIMIT) : redactedData,
          ...(truncated && {
            truncated: true,
            truncatedMessage: `Showing first ${BATCH_DETAIL_LIMIT} of ${redactedData.length} records`,
          }),
        },
      };
    }

    // Fallback (shouldn't happen)
    return { after: { count } };
  }

  private queueAuditLog(data: AuditLogData) {
    if (this.auditCallback) {
      // Queue audit log — AuditService handles retries
      setImmediate(() => {
        this.auditCallback!(data).catch((error) => {
          this.logger.error('Audit callback failed', error instanceof Error ? error.stack : String(error));
        });
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
    // Enable audit middleware on main client
    this.enableAuditMiddleware(this);
    // Start idle client cleanup
    this.startIdleCleanup();
  }

  async onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    await this.$disconnect();
    for (const client of this.tenantClients.values()) {
      await client.$disconnect();
    }
    this.tenantClients.clear();
    this.tenantLastAccess.clear();
  }

  private startIdleCleanup() {
    const idleTimeoutMs = this.configService.get<number>('DB_IDLE_TIMEOUT_MS', 300000);
    // Check every minute for idle clients
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [slug, lastAccess] of this.tenantLastAccess.entries()) {
        if (now - lastAccess > idleTimeoutMs) {
          const client = this.tenantClients.get(slug);
          if (client) {
            this.logger.debug(`Disconnecting idle tenant client: ${slug}`);
            client.$disconnect().catch(() => {});
            this.tenantClients.delete(slug);
            this.tenantLastAccess.delete(slug);
          }
        }
      }
    }, 60_000);
  }

  /**
   * Evict the least-recently-used tenant client to make room for a new one.
   */
  private evictLeastRecentlyUsed(): void {
    let oldestSlug: string | null = null;
    let oldestTime = Infinity;

    for (const [slug, lastAccess] of this.tenantLastAccess.entries()) {
      if (lastAccess < oldestTime) {
        oldestTime = lastAccess;
        oldestSlug = slug;
      }
    }

    if (oldestSlug) {
      const client = this.tenantClients.get(oldestSlug);
      if (client) {
        this.logger.warn(`Evicting LRU tenant client: ${oldestSlug} (pool full at ${this.maxTenantClients})`);
        client.$disconnect().catch(() => {});
      }
      this.tenantClients.delete(oldestSlug);
      this.tenantLastAccess.delete(oldestSlug);
    }
  }

  getTenantClient(tenantSlug: string): TenantPrismaClient {
    if (this.tenantClients.has(tenantSlug)) {
      this.tenantLastAccess.set(tenantSlug, Date.now());
      return this.tenantClients.get(tenantSlug)!;
    }

    // Evict LRU client if pool is full
    if (this.tenantClients.size >= this.maxTenantClients) {
      this.evictLeastRecentlyUsed();
    }

    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not defined');
    }

    const poolSize = this.configService.get<number>('DB_POOL_SIZE', 5);
    const poolTimeout = this.configService.get<number>('DB_POOL_TIMEOUT', 10);

    const url = new URL(databaseUrl);
    url.searchParams.set('schema', `tenant_${tenantSlug.replace(/-/g, '_')}`);
    url.searchParams.set('connection_limit', String(poolSize));
    url.searchParams.set('pool_timeout', String(poolTimeout));

    const client = new PrismaClient({
      datasources: {
        db: {
          url: url.toString(),
        },
      },
    });

    // Enable audit middleware on new tenant clients
    this.enableAuditMiddleware(client, tenantSlug);

    this.tenantClients.set(tenantSlug, client);
    this.tenantLastAccess.set(tenantSlug, Date.now());
    this.logger.debug(`Created tenant client for "${tenantSlug}" (pool: ${poolSize}, timeout: ${poolTimeout}s, total: ${this.tenantClients.size}/${this.maxTenantClients})`);
    return client;
  }

  /** Get the number of active tenant clients (for monitoring) */
  getActiveTenantCount(): number {
    return this.tenantClients.size;
  }

  /** Get the max tenant clients limit (for monitoring) */
  getMaxTenantClients(): number {
    return this.maxTenantClients;
  }
}
