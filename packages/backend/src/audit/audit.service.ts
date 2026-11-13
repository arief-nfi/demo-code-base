import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditConfigService } from './audit-config.service';
import { computeAuditHash, CHAIN_RESET_HASH } from './audit.config';
import type { VerifyResult } from './audit.config';
import * as fs from 'fs';
import * as path from 'path';

export interface AuditLogData {
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'READ';
  entity: string;
  entityId: string;
  userId?: string;
  tenantSlug?: string;
  changes?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
  metadata?: Record<string, any>;
}

const MAX_RETRIES = 3;
const MAX_EXPORT_RECORDS = 100_000;
const FALLBACK_DIR = path.join(process.cwd(), 'backups', 'audit-fallback');
const REPLAYED_DIR = path.join(FALLBACK_DIR, 'replayed');

export interface ReplayResult {
  total: number;
  replayed: number;
  failed: number;
  errors: Array<{ line: number; error: string }>;
}

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);
  private failureCount = 0;
  /** Per-tenant mutex queues to serialize hash chain writes */
  private readonly hashLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditConfigService: AuditConfigService,
  ) {}

  onModuleInit() {
    // Register callback to receive audit logs from Prisma middleware
    this.prisma.setAuditCallback((data) => this.log(data));
    // Register audit config service for per-tenant field config
    this.prisma.setAuditConfigService(this.auditConfigService);

    // Check for pending fallback files
    this.checkPendingFallbacks();
  }

  /**
   * Log a warning on startup if there are unreplayed fallback files.
   */
  private checkPendingFallbacks(): void {
    try {
      if (!fs.existsSync(FALLBACK_DIR)) return;

      const files = fs.readdirSync(FALLBACK_DIR)
        .filter((f) => f.endsWith('.jsonl'));

      if (files.length === 0) return;

      let totalEntries = 0;
      for (const file of files) {
        const content = fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf-8');
        totalEntries += content.split('\n').filter((line) => line.trim()).length;
      }

      this.logger.warn(
        `Found ${files.length} unreplayed fallback file(s) with ${totalEntries} audit entries. ` +
        `POST /plugins/audit-log/replay to recover.`,
      );
    } catch {
      // Non-critical — don't block startup
    }
  }

  /**
   * Acquire a per-tenant lock to serialize hash chain writes.
   * Returns a release function to call when done.
   */
  private acquireHashLock(tenantKey: string): Promise<() => void> {
    const prev = this.hashLocks.get(tenantKey) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.hashLocks.set(tenantKey, prev.then(() => next));
    return prev.then(() => release!);
  }

  /**
   * Create an audit log entry with retry logic and hash chain.
   * On final failure, writes to a local fallback file for later replay.
   */
  async log(data: AuditLogData): Promise<void> {
    const tenantKey = data.tenantSlug ?? '__global__';
    const release = await this.acquireHashLock(tenantKey);

    try {
      await this.logWithRetry(data);
    } finally {
      release();
    }
  }

  /**
   * Detect Prisma foreign key constraint violation (P2003) on the userId field.
   * This happens when the userId references a user in a different schema
   * (e.g., tenant user auditing a system-level operation).
   */
  private isForeignKeyViolationOnUserId(error: unknown): boolean {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as any).code === 'P2003'
    ) {
      const meta = (error as any).meta;
      const fieldName: string = meta?.field_name ?? '';
      return fieldName.includes('userId') || fieldName.includes('user_id');
    }
    return false;
  }

  private async logWithRetry(data: AuditLogData): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const client = data.tenantSlug ? this.prisma.getTenantClient(data.tenantSlug)
          : this.prisma;

        // Get the hash of the most recent entry for this tenant
        const lastEntry = await client.auditLog.findFirst({
          where: { tenantSlug: data.tenantSlug ?? null },
          orderBy: { timestamp: 'desc' },
          select: { hash: true },
        });

        const previousHash = lastEntry?.hash ?? null;
        const timestamp = new Date();

        const hash = computeAuditHash({
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          userId: data.userId,
          tenantSlug: data.tenantSlug,
          changes: data.changes,
          timestamp: timestamp.toISOString(),
          previousHash,
        });

        const createData = {
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          userId: data.userId,
          tenantSlug: data.tenantSlug,
          changes: data.changes as any,
          metadata: data.metadata as any,
          previousHash,
          hash,
          timestamp,
        };

        try {
          await client.auditLog.create({ data: createData });
        } catch (createError) {
          if (this.isForeignKeyViolationOnUserId(createError) && data.userId) {
            // userId references a user in a different schema — store it in metadata instead
            this.logger.warn(
              `userId "${data.userId}" not found in target schema — storing in metadata`,
            );
            await client.auditLog.create({
              data: {
                ...createData,
                userId: null,
                metadata: {
                  ...(data.metadata ?? {}),
                  originalUserId: data.userId,
                },
              },
            });
          } else {
            throw createError;
          }
        }

        return; // Success
      } catch (error) {
        if (attempt < MAX_RETRIES - 1) {
          // Exponential backoff: 100ms, 200ms, 400ms
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100));
          continue;
        }

        // Final failure — write to fallback file
        this.failureCount++;
        this.logger.error(
          `Failed to create audit log after ${MAX_RETRIES} attempts. Writing to fallback file.`,
          error instanceof Error ? error.stack : String(error),
        );
        this.writeToFallback(data);
      }
    }
  }

  /**
   * Write a failed audit log entry to a local fallback file for later replay.
   */
  private writeToFallback(data: AuditLogData): void {
    try {
      if (!fs.existsSync(FALLBACK_DIR)) {
        fs.mkdirSync(FALLBACK_DIR, { recursive: true });
      }

      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const filePath = path.join(FALLBACK_DIR, `audit-fallback-${date}.jsonl`);
      const entry = JSON.stringify({ ...data, failedAt: new Date().toISOString() }) + '\n';

      fs.appendFileSync(filePath, entry, 'utf-8');
    } catch (fileError) {
      this.logger.error('Failed to write audit fallback file', fileError instanceof Error ? fileError.stack : String(fileError));
    }
  }

  /** Get the number of audit write failures (for monitoring) */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Query audit logs with filtering
   */
  async query(
    tenantSlug: string,
    filters: {
      entity?: string;
      entityId?: string;
      userId?: string;
      action?: string;
      search?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {},
  ) {
    const client = await this.prisma.getTenantClient(tenantSlug);
    const { page = 1, limit = 10, search, sortBy = 'timestamp', sortOrder = 'desc', ...where } = filters;

    const whereClause: any = {
      tenantSlug,
    };

    if (where.userId) whereClause.userId = where.userId;
    if (where.action) whereClause.action = where.action;

    if (where.entity) {
      whereClause.entity = {
        contains: where.entity,
        mode: 'insensitive',
      }
    };
    if (where.entityId) {
      whereClause.entityId = {
        contains: where.entityId,
        mode: 'insensitive',
      }
    };

    if (search) {
      whereClause.user = {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      };
    }

    if (where.startDate || where.endDate) {
      whereClause.timestamp = {};
      if (where.startDate) whereClause.timestamp.gte = where.startDate;
      if (where.endDate) whereClause.timestamp.lte = where.endDate;
    }

    // Build orderBy clause based on sortBy and sortOrder
    const orderBy: any = {};
    if (sortBy === 'timestamp' || sortBy === 'action' || sortBy === 'entity') {
      orderBy[sortBy] = sortOrder;
    } else {
      orderBy.timestamp = sortOrder;
    }

    const [logs, total] = await Promise.all([
      client.auditLog.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      client.auditLog.count({ where: whereClause }),
    ]);

    return {
      logs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Query all audit logs matching filters (no pagination).
   * Used for export. Capped at MAX_EXPORT_RECORDS to prevent memory issues.
   */
  async queryAll(
    tenantSlug: string,
    filters: {
      entity?: string;
      entityId?: string;
      userId?: string;
      action?: string;
      search?: string;
      startDate?: Date;
      endDate?: Date;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {},
  ) {
    const client = await this.prisma.getTenantClient(tenantSlug);
    const { search, sortBy = 'timestamp', sortOrder = 'desc', ...where } = filters;

    const whereClause: any = {
      tenantSlug,
    };

    if (where.userId) whereClause.userId = where.userId;
    if (where.action) whereClause.action = where.action;

    if (where.entity) {
      whereClause.entity = {
        contains: where.entity,
        mode: 'insensitive',
      };
    }
    if (where.entityId) {
      whereClause.entityId = {
        contains: where.entityId,
        mode: 'insensitive',
      };
    }

    if (search) {
      whereClause.user = {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      };
    }

    if (where.startDate || where.endDate) {
      whereClause.timestamp = {};
      if (where.startDate) whereClause.timestamp.gte = where.startDate;
      if (where.endDate) whereClause.timestamp.lte = where.endDate;
    }

    const orderBy: any = {};
    if (sortBy === 'timestamp' || sortBy === 'action' || sortBy === 'entity') {
      orderBy[sortBy] = sortOrder;
    } else {
      orderBy.timestamp = sortOrder;
    }

    return client.auditLog.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy,
      take: MAX_EXPORT_RECORDS,
    });
  }

  /**
   * Apply data retention policy to audit logs
   */
  async applyRetention(
    tenantSlug: string,
    options: {
      type: 'time' | 'count';
      beforeDate?: Date;
      keepCount?: number;
      backup?: boolean;
    },
  ): Promise<number> {
    const client = await this.prisma.getTenantClient(tenantSlug);

    try {
      if (options.type === 'time' && options.beforeDate) {
        // Fetch logs to be deleted for backup
        const logsToDelete = await client.auditLog.findMany({
          where: {
            tenantSlug,
            timestamp: {
              lt: options.beforeDate,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        // Backup logs to JSON file if requested
        if (logsToDelete.length > 0 && options.backup !== false) {
          await this.backupLogsToFile(tenantSlug, logsToDelete, 'time-based');
        }

        // Delete logs older than the specified date
        const result = await client.auditLog.deleteMany({
          where: {
            tenantSlug,
            timestamp: {
              lt: options.beforeDate,
            },
          },
        });
        return result.count;
      } else if (options.type === 'count' && options.keepCount) {
        // Keep only the most recent N records
        const totalCount = await client.auditLog.count({
          where: { tenantSlug },
        });

        if (totalCount <= options.keepCount) {
          return 0; // Nothing to delete
        }

        // Find the timestamp of the Nth most recent record
        const keepThreshold = await client.auditLog.findMany({
          where: { tenantSlug },
          orderBy: { timestamp: 'desc' },
          skip: options.keepCount - 1,
          take: 1,
          select: { timestamp: true },
        });

        if (keepThreshold.length === 0) {
          return 0;
        }

        // Fetch logs to be deleted for backup
        const logsToDelete = await client.auditLog.findMany({
          where: {
            tenantSlug,
            timestamp: {
              lt: keepThreshold[0].timestamp,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        // Backup logs to JSON file if requested
        if (logsToDelete.length > 0 && options.backup !== false) {
          await this.backupLogsToFile(tenantSlug, logsToDelete, 'count-based');
        }

        // Delete all logs older than the threshold timestamp
        const result = await client.auditLog.deleteMany({
          where: {
            tenantSlug,
            timestamp: {
              lt: keepThreshold[0].timestamp,
            },
          },
        });
        return result.count;
      }

      return 0;
    } catch (error) {
      this.logger.error('Failed to apply retention policy', error instanceof Error ? error.stack : String(error));
      throw new Error('Failed to apply retention policy');
    }
  }

  /**
   * Replay fallback JSONL files back into the database.
   *
   * - Processes files in chronological order (by filename date).
   * - On full success the file is moved to replayed/.
   * - On partial failure the file is rewritten with only failed entries.
   */
  async replayFallbackLogs(options?: {
    date?: string;
    dryRun?: boolean;
  }): Promise<ReplayResult> {
    const result: ReplayResult = { total: 0, replayed: 0, failed: 0, errors: [] };

    if (!fs.existsSync(FALLBACK_DIR)) return result;

    let files = fs.readdirSync(FALLBACK_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .sort(); // chronological by filename

    if (options?.date) {
      files = files.filter((f) => f.includes(options.date!));
    }

    if (files.length === 0) return result;

    for (const file of files) {
      const filePath = path.join(FALLBACK_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      const failedLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        result.total++;
        try {
          const entry: AuditLogData & { failedAt?: string } = JSON.parse(lines[i]);

          if (options?.dryRun) {
            result.replayed++;
            continue;
          }

          // Remove the failedAt metadata before inserting
          const { failedAt, ...auditData } = entry;

          const client = auditData.tenantSlug
            ? this.prisma.getTenantClient(auditData.tenantSlug)
            : this.prisma;

          const createData = {
            action: auditData.action,
            entity: auditData.entity,
            entityId: auditData.entityId,
            userId: auditData.userId,
            tenantSlug: auditData.tenantSlug,
            changes: auditData.changes as any,
            metadata: auditData.metadata as any,
          };

          try {
            await client.auditLog.create({ data: createData });
          } catch (createError) {
            if (this.isForeignKeyViolationOnUserId(createError) && auditData.userId) {
              this.logger.warn(
                `Replay: userId "${auditData.userId}" not found — storing in metadata`,
              );
              await client.auditLog.create({
                data: {
                  ...createData,
                  userId: null,
                  metadata: {
                    ...(auditData.metadata ?? {}),
                    originalUserId: auditData.userId,
                  },
                },
              });
            } else {
              throw createError;
            }
          }

          result.replayed++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            line: i + 1,
            error: error instanceof Error ? error.message : String(error),
          });
          failedLines.push(lines[i]);
        }
      }

      if (options?.dryRun) continue;

      if (failedLines.length === 0) {
        // All entries replayed successfully — move to replayed/
        if (!fs.existsSync(REPLAYED_DIR)) {
          fs.mkdirSync(REPLAYED_DIR, { recursive: true });
        }
        fs.renameSync(filePath, path.join(REPLAYED_DIR, file));
        this.logger.log(`Replayed all entries from ${file} — moved to replayed/`);
      } else if (failedLines.length < lines.length) {
        // Partial success — rewrite file with only failed entries
        fs.writeFileSync(filePath, failedLines.join('\n') + '\n', 'utf-8');
        this.logger.warn(
          `Partially replayed ${file}: ${lines.length - failedLines.length} succeeded, ${failedLines.length} failed`,
        );
      } else {
        this.logger.error(`All entries in ${file} failed to replay`);
      }
    }

    return result;
  }

  /**
   * Verify the integrity of the audit log hash chain for a tenant.
   *
   * Walks the chain chronologically and recomputes each hash.
   * Chain reset markers (previousHash === null after the first entry) are
   * treated as valid chain restart points (e.g. after retention).
   */
  async verifyIntegrity(
    tenantSlug: string,
    filters?: { startDate?: Date; endDate?: Date },
  ): Promise<VerifyResult> {
    const client = await this.prisma.getTenantClient(tenantSlug);

    const whereClause: any = { tenantSlug };
    if (filters?.startDate || filters?.endDate) {
      whereClause.timestamp = {};
      if (filters.startDate) whereClause.timestamp.gte = filters.startDate;
      if (filters.endDate) whereClause.timestamp.lte = filters.endDate;
    }

    const logs = await client.auditLog.findMany({
      where: whereClause,
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        userId: true,
        tenantSlug: true,
        changes: true,
        timestamp: true,
        previousHash: true,
        hash: true,
      },
    });

    if (logs.length === 0) {
      return { verified: true, checkedCount: 0 };
    }

    let expectedPreviousHash: string | null = null;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      // Skip entries without hash (pre-migration entries)
      if (!log.hash) continue;

      // Chain reset: previousHash is null (genesis or after retention)
      const isChainReset = log.previousHash === null || log.previousHash === CHAIN_RESET_HASH;
      if (isChainReset && i > 0) {
        // Valid chain restart — reset expected hash
        expectedPreviousHash = null;
      }

      // Verify previousHash linkage (skip for first entry and chain resets)
      if (i > 0 && !isChainReset && log.previousHash !== expectedPreviousHash) {
        return {
          verified: false,
          checkedCount: i,
          firstEntry: logs[0].timestamp.toISOString(),
          lastEntry: logs[i].timestamp.toISOString(),
          brokenAt: {
            id: log.id,
            timestamp: log.timestamp.toISOString(),
            expectedHash: expectedPreviousHash ?? '(null)',
            actualHash: log.previousHash,
          },
        };
      }

      // Recompute hash and compare
      const recomputed = computeAuditHash({
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        userId: log.userId ?? undefined,
        tenantSlug: log.tenantSlug ?? undefined,
        changes: log.changes,
        timestamp: log.timestamp.toISOString(),
        previousHash: log.previousHash,
      });

      if (recomputed !== log.hash) {
        return {
          verified: false,
          checkedCount: i + 1,
          firstEntry: logs[0].timestamp.toISOString(),
          lastEntry: logs[i].timestamp.toISOString(),
          brokenAt: {
            id: log.id,
            timestamp: log.timestamp.toISOString(),
            expectedHash: recomputed,
            actualHash: log.hash,
          },
        };
      }

      expectedPreviousHash = log.hash;
    }

    return {
      verified: true,
      checkedCount: logs.length,
      firstEntry: logs[0].timestamp.toISOString(),
      lastEntry: logs[logs.length - 1].timestamp.toISOString(),
    };
  }

  /**
   * Backup audit logs to JSON file
   */
  private async backupLogsToFile(
    tenantSlug: string,
    logs: any[],
    retentionType: string,
  ): Promise<void> {
    try {
      // Create backup directory if it doesn't exist
      const backupDir = path.join(process.cwd(), 'backups', 'audit-logs', tenantSlug);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `audit-backup-${retentionType}-${timestamp}.json`;
      const filePath = path.join(backupDir, filename);

      // Write logs to file
      const backupData = {
        tenantSlug,
        retentionType,
        backupDate: new Date().toISOString(),
        recordCount: logs.length,
        logs,
      };

      fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');
      this.logger.log(`Backed up ${logs.length} audit logs to ${filePath}`);
    } catch (error) {
      this.logger.error('Failed to backup audit logs', error instanceof Error ? error.stack : String(error));
      // Don't throw error to avoid blocking the deletion process
    }
  }
}
