import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService, BaseCrudService, PluginEventService, SystemEvents, type PrismaModelDelegate, type CrudServiceConfig, type CsvColumn } from '@saas/backend';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleQueryDto } from './dto/role-query.dto';
import { createRoleSchemaWithUniqueCheck, updateRoleSchemaWithUniqueCheck } from './roles.schema';

export interface PermissionRef {
  id: string;
  name: string;
  description: string | null;
}

export interface RoleEntity {
  id: string;
  name: string;
  description: string | null;
  permissions: PermissionRef[];
  createdAt: Date;
  _count?: { permissions: number; users: number };
}

@Injectable()
export class RolesService extends BaseCrudService<RoleEntity, RoleQueryDto> {
  protected readonly config: CrudServiceConfig = {
    searchFields: ['name', 'description'],
    defaultSortBy: 'createdAt',
    includes: { permissions: true },
    findAllIncludes: {
      permissions: true,
      _count: { select: { permissions: true, users: true } },
    },
  };

  constructor(
    prisma: PrismaService,
    private pluginEventService: PluginEventService,
  ) {
    super(prisma);
  }

  protected getDelegate(tenantSlug: string): PrismaModelDelegate {
    return this.getClient(tenantSlug).role as unknown as PrismaModelDelegate;
  }

  // ── SYSADMIN Protection Hooks ───────────────────────────────────────────

  protected async beforeRemove(tenantSlug: string, id: string): Promise<void> {
    const client = this.getClient(tenantSlug);
    const role = await client.role.findUnique({ where: { id } });
    if (role && role.name.toUpperCase() === 'SYSADMIN') {
      throw new BadRequestException('Role "SYSADMIN" is reserved and cannot be deleted.');
    }
  }

  protected async beforeRemoveMany(tenantSlug: string, ids: string[]): Promise<void> {
    const client = this.getClient(tenantSlug);
    const roles = await client.role.findMany({ where: { id: { in: ids } } });
    if (roles.some(role => role.name.toUpperCase() === 'SYSADMIN')) {
      throw new BadRequestException('Role "SYSADMIN" is reserved and cannot be deleted.');
    }
  }

  // ── Custom Create/Update ────────────────────────────────────────────────

  async create(tenantSlug: string, createRoleDto: CreateRoleDto) {
    const client = this.getClient(tenantSlug);

    const schema = createRoleSchemaWithUniqueCheck(async (name) => {
      const existing = await client.role.findFirst({ where: { name } });
      return !existing;
    });

    await this.validateDto(schema, createRoleDto);

    const { permissionIds, ...roleData } = createRoleDto;

    const role = await client.role.create({
      data: {
        ...roleData,
        permissions: permissionIds ? {
          connect: permissionIds.map(id => ({ id })),
        } : undefined,
      },
      include: { permissions: true },
    });

    this.pluginEventService.emit(SystemEvents.ROLE_CREATED, {
      tenantSlug,
      roleId: role.id,
      roleName: role.name,
      timestamp: new Date(),
    });

    return role;
  }

  async update(tenantSlug: string, id: string, updateRoleDto: UpdateRoleDto) {
    const client = this.getClient(tenantSlug);

    const roleToUpdate = await client.role.findUnique({ where: { id } });
    if (roleToUpdate && roleToUpdate.name.toUpperCase() === 'SYSADMIN') {
      throw new BadRequestException('Role "SYSADMIN" is reserved and cannot be edited.');
    }

    const schema = updateRoleSchemaWithUniqueCheck(async (name) => {
      const existing = await client.role.findFirst({
        where: { name, NOT: { id } },
      });
      return !existing;
    });

    await this.validateDto(schema, updateRoleDto);

    const { permissionIds, ...roleData } = updateRoleDto;

    const role = await client.role.update({
      where: { id },
      data: {
        ...roleData,
        permissions: permissionIds ? {
          set: permissionIds.map(id => ({ id })),
        } : undefined,
      },
      include: { permissions: true },
    });

    this.pluginEventService.emit(SystemEvents.ROLE_UPDATED, {
      tenantSlug,
      roleId: role.id,
      roleName: role.name,
      timestamp: new Date(),
    });

    return role;
  }

  async export(tenantSlug: string, query: RoleQueryDto) {
    const columns: CsvColumn<RoleEntity>[] = [
      { header: 'ID', accessor: (row) => row.id },
      { header: 'Name', accessor: (row) => `"${(row.name || '').replace(/"/g, '""')}"` },
      { header: 'Description', accessor: (row) => `"${(row.description || '').replace(/"/g, '""')}"` },
      { header: 'Permissions', accessor: (row) => `"${row.permissions.map(p => p.name).join(', ')}"` },
      { header: 'Created At', accessor: (row) => row.createdAt.toISOString() },
    ];
    return this.exportCsv(tenantSlug, query, columns);
  }

  async checkNameAvailability(tenantSlug: string, name: string, excludeId?: string) {
    return this.checkAvailability(tenantSlug, 'name', name, excludeId);
  }
}
