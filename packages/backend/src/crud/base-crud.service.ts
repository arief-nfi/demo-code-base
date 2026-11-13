import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from '../export/export.service';
import type { ExportColumn, ExportFormat, ExportResult } from '../export/export.types';
import type { BaseQueryDto, PaginatedResponse } from '../types';

// ─── Prisma Delegate (structural typing) ────────────────────────────────────

export interface PrismaModelDelegate {
  findMany(args: object): Promise<unknown[]>;
  findUnique(args: object): Promise<unknown | null>;
  count(args: object): Promise<number>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<unknown>;
  delete(args: object): Promise<unknown>;
  deleteMany(args: object): Promise<{ count: number }>;
  findFirst(args: object): Promise<unknown | null>;
}

// ─── CSV Export Column Definition ───────────────────────────────────────────

export interface CsvColumn<T = Record<string, unknown>> {
  header: string;
  accessor: (row: T) => string;
}

// ─── Service Configuration ──────────────────────────────────────────────────

export interface CrudServiceConfig {
  searchFields: string[];
  defaultSortBy?: string;
  includes?: Record<string, unknown>;
  findAllIncludes?: Record<string, unknown>;
}

// ─── Zod-like Schema Interface ──────────────────────────────────────────────

interface ZodLikeSchema<T = unknown> {
  parseAsync(data: unknown): Promise<T>;
}

// ─── Base CRUD Service ──────────────────────────────────────────────────────

export abstract class BaseCrudService<
  TEntity = unknown,
  TQuery extends BaseQueryDto = BaseQueryDto,
> {
  constructor(protected readonly prisma: PrismaService) {}

  // ── Subclass must implement ─────────────────────────────────────────────

  protected abstract readonly config: CrudServiceConfig;

  protected abstract getDelegate(tenantSlug: string): PrismaModelDelegate;

  // ── Optional hooks (override in subclass) ───────────────────────────────

  protected transformResult?(entity: TEntity): unknown;
  protected beforeRemove?(tenantSlug: string, id: string): Promise<void>;
  protected beforeRemoveMany?(tenantSlug: string, ids: string[]): Promise<void>;

  // ── Shared Helpers ──────────────────────────────────────────────────────

  protected getClient(tenantSlug?: string) {
    if (tenantSlug) {
      return this.prisma.getTenantClient(tenantSlug);
    }
    return this.prisma;
  }

  protected buildSearchWhere(search?: string): object {
    if (!search) return {};
    return {
      OR: this.config.searchFields.map(field => ({
        [field]: { contains: search, mode: 'insensitive' as const },
      })),
    };
  }

  // ── Zod Validation Helper ───────────────────────────────────────────────

  protected async validateDto<T>(schema: ZodLikeSchema<T>, data: unknown): Promise<T> {
    try {
      return await schema.parseAsync(data);
    } catch (error) {
      const zodError = error as { issues?: Array<{ path: (string | number)[]; message: string }> };
      if (zodError.issues) {
        const errors: Record<string, string[]> = {};
        for (const issue of zodError.issues) {
          const path = issue.path.join('.') || '_root';
          if (!errors[path]) {
            errors[path] = [];
          }
          errors[path].push(issue.message);
        }
        throw new BadRequestException({ message: 'Validation failed', errors });
      }
      throw error;
    }
  }

  // ── CRUD Operations ─────────────────────────────────────────────────────

  async findAll(tenantSlug: string, query: TQuery): Promise<PaginatedResponse<TEntity>> {
    const delegate = this.getDelegate(tenantSlug);
    const { page = 1, limit = 10, search, sortBy, sortOrder = 'desc' } = query;
    const effectiveSortBy = sortBy || this.config.defaultSortBy || 'createdAt';
    const skip = (page - 1) * limit;
    const where = this.buildSearchWhere(search);
    const includes = this.config.findAllIncludes || this.config.includes;

    const [rawData, total] = await Promise.all([
      delegate.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [effectiveSortBy]: sortOrder },
        ...(includes && Object.keys(includes).length > 0 ? { include: includes } : {}),
      }),
      delegate.count({ where }),
    ]);

    const data = this.transformResult
      ? (rawData as TEntity[]).map(item => this.transformResult!(item) as TEntity)
      : (rawData as TEntity[]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(tenantSlug: string, id: string): Promise<TEntity | null> {
    const delegate = this.getDelegate(tenantSlug);
    const includes = this.config.includes;

    const entity = await delegate.findUnique({
      where: { id },
      ...(includes && Object.keys(includes).length > 0 ? { include: includes } : {}),
    });

    if (!entity) return null;

    return this.transformResult
      ? this.transformResult(entity as TEntity) as TEntity
      : entity as TEntity;
  }

  async remove(tenantSlug: string, id: string): Promise<TEntity> {
    if (this.beforeRemove) {
      await this.beforeRemove(tenantSlug, id);
    }
    const delegate = this.getDelegate(tenantSlug);
    return delegate.delete({ where: { id } }) as Promise<TEntity>;
  }

  async removeMany(tenantSlug: string, ids: string[]): Promise<{ count: number }> {
    if (this.beforeRemoveMany) {
      await this.beforeRemoveMany(tenantSlug, ids);
    }
    const delegate = this.getDelegate(tenantSlug);
    return delegate.deleteMany({ where: { id: { in: ids } } });
  }

  async exportCsv(
    tenantSlug: string,
    query: TQuery,
    columns: CsvColumn<TEntity>[],
  ): Promise<string> {
    const delegate = this.getDelegate(tenantSlug);
    const { search, sortBy, sortOrder = 'desc' } = query;
    const effectiveSortBy = sortBy || this.config.defaultSortBy || 'createdAt';
    const where = this.buildSearchWhere(search);
    const includes = this.config.includes;

    const rawData = await delegate.findMany({
      where,
      orderBy: { [effectiveSortBy]: sortOrder },
      ...(includes && Object.keys(includes).length > 0 ? { include: includes } : {}),
    });

    const data = this.transformResult
      ? (rawData as TEntity[]).map(item => this.transformResult!(item) as TEntity)
      : (rawData as TEntity[]);

    const header = columns.map(c => c.header);
    const rows = data.map(row => columns.map(col => col.accessor(row)));

    return [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  async exportData(
    tenantSlug: string,
    query: TQuery,
    columns: ExportColumn<TEntity>[],
    format: ExportFormat = 'csv',
  ): Promise<ExportResult> {
    const delegate = this.getDelegate(tenantSlug);
    const { search, sortBy, sortOrder = 'desc' } = query;
    const effectiveSortBy = sortBy || this.config.defaultSortBy || 'createdAt';
    const where = this.buildSearchWhere(search);
    const includes = this.config.includes;

    const rawData = await delegate.findMany({
      where,
      orderBy: { [effectiveSortBy]: sortOrder },
      ...(includes && Object.keys(includes).length > 0 ? { include: includes } : {}),
    });

    const data = this.transformResult
      ? (rawData as TEntity[]).map(item => this.transformResult!(item) as TEntity)
      : (rawData as TEntity[]);

    const exportService = new ExportService();
    return exportService.export(columns as ExportColumn<Record<string, unknown>>[], data as Record<string, unknown>[], format);
  }

  async checkAvailability(
    tenantSlug: string,
    field: string,
    value: string,
    excludeId?: string,
  ): Promise<{ available: boolean }> {
    const delegate = this.getDelegate(tenantSlug);
    const existing = await delegate.findFirst({
      where: {
        [field]: value,
        NOT: excludeId ? { id: excludeId } : undefined,
      },
    });
    return { available: !existing };
  }
}
