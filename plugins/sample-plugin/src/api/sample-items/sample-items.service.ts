import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import type { SampleItemQueryDto } from './dto/sample-item-query.dto';
import type { CreateSampleItemDto } from './dto/create-sample-item.dto';
import type { UpdateSampleItemDto } from './dto/update-sample-item.dto';

export interface UserRef {
  id: string;
  name: string | null;
  username: string;
}

export interface SampleItem {
  id: string;
  name: string;
  value?: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
  createdAt: string;
}

@Injectable()
export class SampleItemsService {
  constructor(private prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  async findAll(tenantSlug: string, params: SampleItemQueryDto) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { value: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      client.sampleItem.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
      }),
      client.sampleItem.count({ where }),
    ]);

    const userMap = await this.fetchUsers(
      client,
      rows.flatMap((r) => [r.createdById, r.updatedById]),
    );

    return {
      data: rows.map((r) => this.toDto(r, userMap)),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private toDto(
    item: {
      id: string;
      name: string;
      value: string | null;
      createdById: string | null;
      updatedById: string | null;
      createdAt: Date;
    },
    userMap: Map<string, UserRef>,
  ): SampleItem {
    return {
      id: item.id,
      name: item.name,
      value: item.value,
      createdById: item.createdById,
      updatedById: item.updatedById,
      createdBy: item.createdById ? userMap.get(item.createdById) ?? null : null,
      updatedBy: item.updatedById ? userMap.get(item.updatedById) ?? null : null,
      createdAt: item.createdAt.toISOString(),
    };
  }

  /**
   * Cross-fragment lookup: User lives in header.prisma, not this plugin's fragment,
   * so we resolve via a separate batched findMany — never `include`.
   */
  private async fetchUsers(
    client: ReturnType<PrismaService['getTenantClient']>,
    ids: ReadonlyArray<string | null | undefined>,
  ): Promise<Map<string, UserRef>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
    if (unique.length === 0) return new Map();
    const users = await client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, username: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  async findOne(id: string, tenantSlug: string): Promise<SampleItem> {
    const client = this.getClient(tenantSlug);
    const item = await client.sampleItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Sample item with ID ${id} not found`);
    }
    const userMap = await this.fetchUsers(client, [item.createdById, item.updatedById]);
    return this.toDto(item, userMap);
  }

  async create(createDto: CreateSampleItemDto, userId: string, tenantSlug: string): Promise<SampleItem> {
    const client = this.getClient(tenantSlug);
    const available = await this.checkNameAvailable(createDto.name, undefined, tenantSlug);
    if (!available) {
      throw new ConflictException(`Sample item with name '${createDto.name}' already exists`);
    }

    const item = await client.sampleItem.create({
      data: {
        name: createDto.name,
        value: createDto.value,
        createdById: userId,
        updatedById: userId,
      },
    });
    const userMap = await this.fetchUsers(client, [item.createdById, item.updatedById]);
    return this.toDto(item, userMap);
  }

  async update(id: string, updateDto: UpdateSampleItemDto, userId: string, tenantSlug: string): Promise<SampleItem> {
    const client = this.getClient(tenantSlug);
    if (updateDto.name) {
      const available = await this.checkNameAvailable(updateDto.name, id, tenantSlug);
      if (!available) {
        throw new ConflictException(`Sample item with name '${updateDto.name}' already exists`);
      }
    }
    try {
      const item = await client.sampleItem.update({
        where: { id },
        data: { ...updateDto, updatedById: userId },
      });
      const userMap = await this.fetchUsers(client, [item.createdById, item.updatedById]);
      return this.toDto(item, userMap);
    } catch {
      throw new NotFoundException(`Sample item with ID ${id} not found`);
    }
  }

  async remove(id: string, tenantSlug: string): Promise<void> {
    const client = this.getClient(tenantSlug);
    try {
      await client.sampleItem.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Sample item with ID ${id} not found`);
    }
  }

  async bulkDelete(ids: string[], tenantSlug: string): Promise<void> {
    const client = this.getClient(tenantSlug);
    await client.sampleItem.deleteMany({ where: { id: { in: ids } } });
  }

  async checkNameAvailable(name: string, excludeId: string | undefined, tenantSlug: string): Promise<boolean> {
    const client = this.getClient(tenantSlug);
    const where: Record<string, unknown> = { name };
    if (excludeId) where.id = { not: excludeId };
    const count = await client.sampleItem.count({ where });
    return count === 0;
  }
}
