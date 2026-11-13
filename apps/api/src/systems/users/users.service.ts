import { Injectable } from '@nestjs/common';
import { PrismaService, BaseCrudService, PluginEventService, SystemEvents, type PrismaModelDelegate, type CrudServiceConfig, type CsvColumn, type ExportColumn, type ExportFormat } from '@saas/backend';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { createUserSchemaWithUniqueCheck, updateUserSchemaWithUniqueCheck } from './users.schema';
import * as bcrypt from 'bcrypt';

export interface RoleRef {
  id: string;
  name: string;
}

export interface UserEntity {
  id: string;
  email: string;
  username: string;
  name: string | null;
  password: string;
  status: string;
  avatar: string | null;
  roles: RoleRef[];
  createdAt: Date;
}

export type UserWithoutPassword = Omit<UserEntity, 'password'>;

@Injectable()
export class UsersService extends BaseCrudService<UserEntity, UserQueryDto> {
  protected readonly config: CrudServiceConfig = {
    searchFields: ['email', 'username', 'name'],
    defaultSortBy: 'createdAt',
    includes: { roles: true },
  };

  constructor(
    prisma: PrismaService,
    private configService: ConfigService,
    private pluginEventService: PluginEventService,
  ) {
    super(prisma);
  }

  protected getDelegate(tenantSlug: string): PrismaModelDelegate {
    return this.getClient(tenantSlug).user as unknown as PrismaModelDelegate;
  }

  protected transformResult(entity: UserEntity): UserWithoutPassword {
    const { password, ...rest } = entity;
    return rest;
  }

  // ── Custom Create/Update ────────────────────────────────────────────────

  async create(tenantSlug: string, createUserDto: CreateUserDto) {
    const client = this.getClient(tenantSlug);

    const schema = createUserSchemaWithUniqueCheck(
      async (email) => {
        const existing = await client.user.findFirst({ where: { email } });
        return !existing;
      },
      async (username) => {
        const existing = await client.user.findFirst({ where: { username } });
        return !existing;
      }
    );

    await this.validateDto(schema, createUserDto);

    const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
    const hashedPassword = await bcrypt.hash(createUserDto.password, saltRounds);

    const { roleIds, ...userData } = createUserDto;

    const user = await client.user.create({
      data: {
        ...userData,
        password: hashedPassword,
        roles: roleIds ? {
          connect: roleIds.map(id => ({ id })),
        } : undefined,
      },
      include: { roles: true },
    });

    const { password, ...rest } = user;

    this.pluginEventService.emit(SystemEvents.USER_CREATED, {
      tenantSlug,
      userId: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles.map((r: RoleRef) => r.name),
      timestamp: new Date(),
    });

    return rest;
  }

  async update(tenantSlug: string, id: string, updateUserDto: UpdateUserDto) {
    const client = this.getClient(tenantSlug);

    const schema = updateUserSchemaWithUniqueCheck(
      async (email) => {
        const existing = await client.user.findFirst({
          where: { email, NOT: { id } },
        });
        return !existing;
      },
      async (username) => {
        const existing = await client.user.findFirst({
          where: { username, NOT: { id } },
        });
        return !existing;
      }
    );

    await this.validateDto(schema, updateUserDto);

    const { roleIds, password, ...userData } = updateUserDto;
    const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
    const before = userData.status ? await client.user.findUnique({ where: { id }, select: { status: true } }) : null;

    const updatedUser = await client.user.update({
      where: { id },
      data: {
        ...userData,
        ...(password ? { password: await bcrypt.hash(password, saltRounds) } : {}),
        ...(roleIds ? { roles: { set: roleIds.map(rid => ({ id: rid })) } } : {}),
      },
      include: { roles: true },
    });

    const { password: _, ...rest } = updatedUser;

    this.pluginEventService.emit(SystemEvents.USER_UPDATED, {
      tenantSlug,
      userId: updatedUser.id,
      username: updatedUser.username,
      email: updatedUser.email,
      changes: userData,
      timestamp: new Date(),
    });
    if (before && before.status !== updatedUser.status) {
      this.pluginEventService.emit(SystemEvents.USER_STATUS_CHANGED, {
        tenantSlug,
        userId: updatedUser.id,
        status: updatedUser.status,
        previousStatus: before.status,
        timestamp: new Date(),
      });
    }

    return rest;
  }

  // ── Delete (emits user.deleted so plugins can clean up after the user) ──

  async remove(tenantSlug: string, id: string): Promise<UserEntity> {
    const deleted = await super.remove(tenantSlug, id);
    this.emitDeleted(tenantSlug, [deleted]);
    return deleted;
  }

  async removeMany(tenantSlug: string, ids: string[]): Promise<{ count: number }> {
    const doomed = await this.getClient(tenantSlug).user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, email: true },
    });
    const result = await super.removeMany(tenantSlug, ids);
    this.emitDeleted(tenantSlug, doomed);
    return result;
  }

  private emitDeleted(tenantSlug: string, users: Array<Pick<UserEntity, 'id' | 'username' | 'email'>>): void {
    for (const user of users) {
      this.pluginEventService.emit(SystemEvents.USER_DELETED, {
        tenantSlug,
        userId: user.id,
        username: user.username,
        email: user.email,
        timestamp: new Date(),
      });
    }
  }

  async export(tenantSlug: string, query: UserQueryDto) {
    const columns: CsvColumn<UserEntity>[] = [
      { header: 'ID', accessor: (row) => row.id },
      { header: 'Email', accessor: (row) => `"${(row.email || '').replace(/"/g, '""')}"` },
      { header: 'Username', accessor: (row) => `"${(row.username || '').replace(/"/g, '""')}"` },
      { header: 'Name', accessor: (row) => `"${(row.name || '').replace(/"/g, '""')}"` },
      { header: 'Status', accessor: (row) => row.status },
      { header: 'Roles', accessor: (row) => `"${(row.roles.map(r => r.name).join(', ') || '').replace(/"/g, '""')}"` },
      { header: 'Created At', accessor: (row) => row.createdAt.toISOString() },
    ];
    return this.exportCsv(tenantSlug, query, columns);
  }

  async exportUsers(tenantSlug: string, query: UserQueryDto, format: ExportFormat = 'csv') {
    const columns: ExportColumn<UserEntity>[] = [
      { header: 'ID', accessor: (row) => row.id, width: 36 },
      { header: 'Email', accessor: (row) => row.email || '', width: 30 },
      { header: 'Username', accessor: (row) => row.username || '', width: 20 },
      { header: 'Name', accessor: (row) => row.name || '', width: 20 },
      { header: 'Status', accessor: (row) => row.status, width: 10 },
      { header: 'Roles', accessor: (row) => row.roles.map((r: any) => r.name).join(', '), width: 20 },
      { header: 'Created At', accessor: (row) => row.createdAt.toISOString(), width: 22 },
    ];
    return super.exportData(tenantSlug, query, columns, format);
  }

  async checkUsernameAvailability(tenantSlug: string, username: string, excludeId?: string) {
    return this.checkAvailability(tenantSlug, 'username', username, excludeId);
  }

  async checkEmailAvailability(tenantSlug: string, email: string, excludeId?: string) {
    return this.checkAvailability(tenantSlug, 'email', email, excludeId);
  }
}
