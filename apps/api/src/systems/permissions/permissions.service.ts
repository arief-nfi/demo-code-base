import { Injectable } from '@nestjs/common';
import { PrismaService, BaseCrudService, type PrismaModelDelegate, type CrudServiceConfig, type CsvColumn } from '@saas/backend';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PermissionQueryDto } from './dto/permission-query.dto';
import { createPermissionSchemaWithUniqueCheck, updatePermissionSchemaWithUniqueCheck } from './permissions.schema';

export interface PermissionEntity {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

@Injectable()
export class PermissionsService extends BaseCrudService<PermissionEntity, PermissionQueryDto> {
  protected readonly config: CrudServiceConfig = {
    searchFields: ['name', 'description'],
    defaultSortBy: 'createdAt',
    includes: {},
  };

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected getDelegate(tenantSlug: string): PrismaModelDelegate {
    return this.getClient(tenantSlug).permission as unknown as PrismaModelDelegate;
  }

  async create(tenantSlug: string, createPermissionDto: CreatePermissionDto) {
    const client = this.getClient(tenantSlug);

    const schema = createPermissionSchemaWithUniqueCheck(async (name) => {
      const existing = await client.permission.findFirst({ where: { name } });
      return !existing;
    });

    await this.validateDto(schema, createPermissionDto);

    return client.permission.create({
      data: createPermissionDto,
    });
  }

  async update(tenantSlug: string, id: string, updatePermissionDto: UpdatePermissionDto) {
    const client = this.getClient(tenantSlug);

    const schema = updatePermissionSchemaWithUniqueCheck(async (name) => {
      const existing = await client.permission.findFirst({
        where: { name, NOT: { id } },
      });
      return !existing;
    });

    await this.validateDto(schema, updatePermissionDto);

    return client.permission.update({
      where: { id },
      data: updatePermissionDto,
    });
  }

  async export(tenantSlug: string, query: PermissionQueryDto) {
    const columns: CsvColumn<PermissionEntity>[] = [
      { header: 'ID', accessor: (row) => row.id },
      { header: 'Name', accessor: (row) => `"${(row.name || '').replace(/"/g, '""')}"` },
      { header: 'Description', accessor: (row) => `"${(row.description || '').replace(/"/g, '""')}"` },
      { header: 'Created At', accessor: (row) => row.createdAt.toISOString() },
    ];
    return this.exportCsv(tenantSlug, query, columns);
  }

  async checkNameAvailability(tenantSlug: string, name: string, excludeId?: string) {
    return this.checkAvailability(tenantSlug, 'name', name, excludeId);
  }
}
