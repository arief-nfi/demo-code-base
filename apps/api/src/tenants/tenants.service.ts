import { Inject, Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { EMAIL_SERVICE, PrismaService, PluginEventService, SystemEvents, type IEmailService } from '@saas/backend';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { PluginPermissions } from '../plugin-registry';

const execAsync = promisify(exec);

/** Find the monorepo root by walking up from cwd looking for pnpm-workspace.yaml */
function findMonorepoRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find monorepo root (pnpm-workspace.yaml)');
}

/** Validate a PostgreSQL schema name to prevent SQL injection. Only allows alphanumeric and underscores. */
function validateSchemaName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)) {
    throw new BadRequestException(`Invalid schema name: "${name}". Only alphanumeric characters and underscores are allowed.`);
  }
  return name;
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Inject(EMAIL_SERVICE) private email: IEmailService,
    private pluginEventService: PluginEventService,
  ) { }

  async findAll() {
    return this.prisma.tenant.findMany();
  }

  /**
   * `seedAdminPassword` comes from `pnpm db:seed` only (DEFAULT_ADMIN_PASSWORD): the admin signs in with it, so
   * there is no setup link and no welcome email. Every other new admin gets a link to set their own password.
   */
  async create(createTenantDto: CreateTenantDto, seedAdminPassword?: string) {
    // 1. Create Tenant in public schema
    const { name, slug } = createTenantDto;
    const tenant = await this.prisma.tenant.create({
      data: {
        name,
        slug,
      },
    });

    const schemaName = validateSchemaName(`tenant_${tenant.slug.replace(/-/g, '_')}`);

    try {
      // 2. Create Schema
      await this.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

      // 3. Provision Schema (Run migrations or push)
      const databaseUrl = this.configService.get<string>('DATABASE_URL');
      if (!databaseUrl) {
        throw new InternalServerErrorException('DATABASE_URL is not configured');
      }
      const tenantUrl = new URL(databaseUrl);
      tenantUrl.searchParams.set('schema', schemaName);

      const root = findMonorepoRoot();
      const schemaPath = path.resolve(root, 'packages', 'database', 'prisma', 'schema.prisma');
      const prismaBin = path.resolve(root, 'packages', 'database', 'node_modules', '.bin', 'prisma');

      // Use migrate deploy if migrations exist, otherwise fall back to db push
      const envOpts = { env: { ...process.env, DATABASE_URL: tenantUrl.toString() } };
      try {
        await execAsync(`"${prismaBin}" migrate deploy --schema "${schemaPath}"`, envOpts);
      } catch {
        // Fallback to db push if no migrations exist yet
        await execAsync(`"${prismaBin}" db push --schema "${schemaPath}" --skip-generate`, envOpts);
      }

      // 4. Seed Default Roles & Permissions
      const tenantClient = this.prisma.getTenantClient(tenant.slug);

      // Seed Tenant Data in Tenant Schema
      await tenantClient.tenant.create({
        data: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          config: {
            create: {}, // Default config
          },
        },
      });

      // Create Permissions
      const systemPermissions = ['system.user.read', 'system.user.write', 'system.role.read', 'system.role.write', 'system.permission.read', 'system.permission.write', 'system.workflow.view', 'system.workflow.manage', 'system.email.read', 'system.email.write'];
      
      // Collect all plugin permissions
      const pluginPermissions: Array<{ name: string; description?: string }> = [];
      Object.values(PluginPermissions).forEach(perms => {
        pluginPermissions.push(...perms);
      });

      // Combine system and plugin permissions
      const allPermissionData = [
        ...systemPermissions.map(name => ({ name, description: `Permission to ${name}` })),
        ...pluginPermissions
      ];

      await tenantClient.permission.createMany({
        data: allPermissionData,
      });

      const allPermissions = await tenantClient.permission.findMany();

      // Create System Admin Role if system tenant
      let sysadminRoleId: string | null = null;
      if (tenant.slug === 'system') {
        const sysadminRole = await tenantClient.role.create({
          data: {
            name: 'SYSADMIN',
            description: 'Reserved System Administrator role',
          },
        });
        sysadminRoleId = sysadminRole.id;
      }

      // Create Admin Role
      const adminRole = await tenantClient.role.create({
        data: {
          name: 'ADMIN',
          description: 'Administrator role',
          permissions: {
            connect: allPermissions.map(p => ({ id: p.id })),
          },
        },
      });

      // Create User Role — starts with no permissions; tenant admins assign them in the Roles screen
      await tenantClient.role.create({
        data: {
          name: 'USER',
          description: 'Standard user role',
        },
      });

      // 5. Create the default admin user: with the seed's password, or a random one plus a 24-hour setup token
      const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
      const hashedPassword = await bcrypt.hash(seedAdminPassword ?? crypto.randomBytes(32).toString('hex'), saltRounds);
      const adminEmail = createTenantDto.adminEmail || `admin@${createTenantDto.slug}.com`;
      const adminUsername = createTenantDto.adminUsername || 'admin';
      const resetToken = seedAdminPassword === undefined ? crypto.randomBytes(32).toString('hex') : null;

      await tenantClient.user.create({
        data: {
          email: adminEmail,
          username: adminUsername,
          password: hashedPassword,
          name: createTenantDto.adminName || 'Admin User',
          ...(resetToken && {
            resetPasswordToken: crypto.createHash('sha256').update(resetToken).digest('hex'),
            resetPasswordExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }),
          roles: {
            connect: { id: sysadminRoleId || adminRole.id },
          },
        },
      });

      // 6. Send the welcome email with the password setup link (no plaintext password)
      if (resetToken) {
        try {
          const frontendUrl = this.configService.get<string>('FRONTEND_URL');
          await this.email.send({
            template: 'core.tenant-welcome',
            tenantSlug: tenant.slug,
            to: adminEmail,
            data: {
              tenantName: tenant.name,
              username: `${adminUsername}@${tenant.slug}`,
              setupUrl: `${frontendUrl}/reset-password?${new URLSearchParams({ token: resetToken, tenant: tenant.slug })}`,
            },
          });
        } catch (emailError) {
          this.logger.error('Failed to send welcome email', emailError instanceof Error ? emailError.stack : emailError);
          // Don't fail the tenant creation if email fails
        }
      }

      this.pluginEventService.emit(SystemEvents.TENANT_CREATED, {
        tenantSlug: tenant.slug,
        tenantId: tenant.id,
        tenantName: tenant.name,
        timestamp: new Date(),
      });

      return tenant;
    } catch (error) {
      this.logger.error('Failed to provision tenant', error instanceof Error ? error.stack : error);

      // Compensating cleanup: remove partially-provisioned resources
      await this.cleanupFailedProvision(tenant.id, schemaName);

      throw new InternalServerErrorException('Failed to provision tenant');
    }
  }

  /**
   * Compensating cleanup for a failed tenant provisioning.
   * Drops the schema (if created) and removes the Tenant record from public schema.
   * Each step is best-effort — failures are logged but don't propagate.
   */
  private async cleanupFailedProvision(tenantId: string, schemaName: string): Promise<void> {
    this.logger.warn(`Cleaning up failed provisioning for tenant ${tenantId} (schema: ${schemaName})`);

    // 1. Drop the partially-created schema (CASCADE removes all objects within it)
    try {
      await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      this.logger.log(`Dropped schema "${schemaName}" during cleanup`);
    } catch (dropError) {
      this.logger.error(
        `Failed to drop schema "${schemaName}" during cleanup — manual intervention required`,
        dropError instanceof Error ? dropError.stack : dropError,
      );
    }

    // 2. Remove the Tenant record from public schema
    try {
      await this.prisma.tenant.delete({ where: { id: tenantId } });
      this.logger.log(`Deleted tenant record ${tenantId} during cleanup`);
    } catch (deleteError) {
      this.logger.error(
        `Failed to delete tenant record ${tenantId} during cleanup — manual intervention required`,
        deleteError instanceof Error ? deleteError.stack : deleteError,
      );
    }
  }

  async registerTenant(dto: RegisterTenantDto) {
    // Check slug uniqueness
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      throw new BadRequestException(`Tenant with slug '${dto.slug}' already exists`);
    }

    const trialDays = this.configService.get<number>('DEFAULT_TRIAL_DAYS', 0);
    const isTrial = trialDays > 0;
    const now = new Date();

    // Create via the existing create method with the admin password set directly
    const createDto: CreateTenantDto = {
      name: dto.companyName,
      slug: dto.slug,
      adminEmail: dto.adminEmail,
      adminUsername: dto.adminEmail.split('@')[0],
      adminName: dto.adminName,
      adminPassword: dto.adminPassword,
    };

    // Use the existing create flow
    const tenant = await this.create(createDto);

    // Set lifecycle fields
    const lifecycleData: Record<string, unknown> = {
      status: isTrial ? 'TRIAL' : 'ACTIVE',
      onboardingCompleted: false,
    };
    if (isTrial) {
      lifecycleData.trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    }

    await this.updateTenantInBothSchemas(tenant.id, tenant.slug, lifecycleData);

    // If admin set their own password, clear the reset token
    if (dto.adminPassword) {
      const tenantClient = this.prisma.getTenantClient(tenant.slug);
      const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
      const hashedPassword = await bcrypt.hash(dto.adminPassword, saltRounds);
      await tenantClient.user.updateMany({
        where: { email: dto.adminEmail },
        data: {
          password: hashedPassword,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      });
    }

    this.pluginEventService.emit(SystemEvents.TENANT_REGISTERED, {
      tenantSlug: tenant.slug,
      tenantId: tenant.id,
      tenantName: tenant.name,
      timestamp: now,
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: isTrial ? 'TRIAL' : 'ACTIVE',
      },
      admin: {
        username: dto.adminEmail.split('@')[0],
        email: dto.adminEmail,
      },
    };
  }

  async getTenantConfig(tenantId: string) {
    // We need to find the tenant first to get the slug
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new InternalServerErrorException('Tenant not found');
    }

    const tenantClient = this.prisma.getTenantClient(tenant.slug);

    // Get config from tenant schema
    const config = await tenantClient.tenantConfig.findUnique({
      where: { tenantId: tenant.id },
      include: { tenant: true },
    });

    return config;
  }

  async updateTenantConfig(tenantId: string, updateDto: UpdateTenantConfigDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new InternalServerErrorException('Tenant not found');
    }

    const tenantClient = this.prisma.getTenantClient(tenant.slug);

    // Update Tenant Config in Tenant Schema
    // Also update Tenant name if provided
    if (updateDto.name) {
      await tenantClient.tenant.update({
        where: { id: tenantId },
        data: { name: updateDto.name },
      });

      // Also update in public schema?
      // Ideally yes, to keep them in sync
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { name: updateDto.name },
      });
    }

    const { name, ...configData } = updateDto;

    return tenantClient.tenantConfig.update({
      where: { tenantId: tenantId },
      data: configData,
    });
  }

  async getPublicBranding(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return null;
    const tenantClient = this.prisma.getTenantClient(slug);
    const config = await tenantClient.tenantConfig.findFirst();
    return {
      name: tenant.name,
      logo: config?.logo ?? null,
      icon: config?.icon ?? null,
      primaryColor: config?.primaryColor ?? null,
    };
  }

  async updateTenantStatus(tenantId: string, status: 'ACTIVE' | 'INACTIVE') {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new InternalServerErrorException('Tenant not found');
    }

    // Update in public schema
    const updatedTenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status },
    });

    // Also update in tenant schema to keep them in sync
    const tenantClient = this.prisma.getTenantClient(tenant.slug);
    await tenantClient.tenant.update({
      where: { id: tenantId },
      data: { status },
    });

    this.pluginEventService.emit(SystemEvents.TENANT_STATUS_CHANGED, {
      tenantSlug: tenant.slug,
      tenantId: tenant.id,
      tenantName: tenant.name,
      status,
      timestamp: new Date(),
    });

    return updatedTenant;
  }

  // --- Lifecycle Methods ---

  private async updateTenantInBothSchemas(tenantId: string, slug: string, data: Record<string, unknown>) {
    await this.prisma.tenant.update({ where: { id: tenantId }, data });
    const tenantClient = this.prisma.getTenantClient(slug);
    await tenantClient.tenant.update({ where: { id: tenantId }, data });
  }

  async suspendTenant(tenantId: string, reason: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant not found');
    if (tenant.status === 'SUSPENDED') throw new BadRequestException('Tenant is already suspended');
    if (tenant.status === 'TERMINATED') throw new BadRequestException('Cannot suspend a terminated tenant');

    const now = new Date();
    await this.updateTenantInBothSchemas(tenantId, tenant.slug, {
      status: 'SUSPENDED',
      suspendedAt: now,
      suspendedReason: reason,
    });

    this.pluginEventService.emit(SystemEvents.TENANT_SUSPENDED, {
      tenantSlug: tenant.slug,
      tenantId: tenant.id,
      tenantName: tenant.name,
      timestamp: now,
      reason,
    });

    // Send notification email to tenant admin
    try {
      const tenantClient = this.prisma.getTenantClient(tenant.slug);
      const admin = await tenantClient.user.findFirst({
        where: { roles: { some: { name: 'ADMIN' } } },
      });
      if (admin?.email) {
        await this.email.send({
          template: 'core.tenant-suspended',
          tenantSlug: tenant.slug,
          to: admin.email,
          data: { tenantName: tenant.name, reason },
        });
      }
    } catch (e) {
      this.logger.warn('Failed to send suspension email', e);
    }

    return this.prisma.tenant.findUnique({ where: { id: tenantId } });
  }

  async reactivateTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant not found');
    if (!['SUSPENDED', 'INACTIVE'].includes(tenant.status)) {
      throw new BadRequestException(`Cannot reactivate tenant with status '${tenant.status}'`);
    }

    const now = new Date();
    await this.updateTenantInBothSchemas(tenantId, tenant.slug, {
      status: 'ACTIVE',
      suspendedAt: null,
      suspendedReason: null,
    });

    this.pluginEventService.emit(SystemEvents.TENANT_REACTIVATED, {
      tenantSlug: tenant.slug,
      tenantId: tenant.id,
      tenantName: tenant.name,
      timestamp: now,
    });

    // Send notification email
    try {
      const tenantClient = this.prisma.getTenantClient(tenant.slug);
      const admin = await tenantClient.user.findFirst({
        where: { roles: { some: { name: 'ADMIN' } } },
      });
      if (admin?.email) {
        await this.email.send({
          template: 'core.tenant-reactivated',
          tenantSlug: tenant.slug,
          to: admin.email,
          data: { tenantName: tenant.name, loginUrl: `${this.configService.get<string>('FRONTEND_URL')}/login` },
        });
      }
    } catch (e) {
      this.logger.warn('Failed to send reactivation email', e);
    }

    return this.prisma.tenant.findUnique({ where: { id: tenantId } });
  }

  async terminateTenant(tenantId: string, graceDays?: number) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant not found');
    if (tenant.status === 'TERMINATED') throw new BadRequestException('Tenant is already terminated');

    const now = new Date();
    const days = graceDays ?? this.configService.get<number>('TERMINATION_GRACE_DAYS', 30);
    const terminationDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    await this.updateTenantInBothSchemas(tenantId, tenant.slug, {
      status: 'TERMINATED',
      terminatedAt: now,
      terminationDate,
    });

    this.pluginEventService.emit(SystemEvents.TENANT_TERMINATED, {
      tenantSlug: tenant.slug,
      tenantId: tenant.id,
      tenantName: tenant.name,
      timestamp: now,
      terminationDate,
    });

    // Send notification email
    try {
      const tenantClient = this.prisma.getTenantClient(tenant.slug);
      const admin = await tenantClient.user.findFirst({
        where: { roles: { some: { name: 'ADMIN' } } },
      });
      if (admin?.email) {
        await this.email.send({
          template: 'core.tenant-terminated',
          tenantSlug: tenant.slug,
          to: admin.email,
          data: { tenantName: tenant.name, terminationDate: terminationDate.toISOString().slice(0, 10) },
        });
      }
    } catch (e) {
      this.logger.warn('Failed to send termination email', e);
    }

    return this.prisma.tenant.findUnique({ where: { id: tenantId } });
  }

  async exportTenantData(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant not found');

    const tenantClient = this.prisma.getTenantClient(tenant.slug);

    const [users, roles, permissions, config, plugins, subscriptions, auditLogs] = await Promise.all([
      tenantClient.user.findMany({ select: { id: true, email: true, username: true, name: true, status: true, createdAt: true } }),
      tenantClient.role.findMany({ include: { permissions: { select: { name: true } } } }),
      tenantClient.permission.findMany({ select: { name: true, description: true } }),
      tenantClient.tenantConfig.findFirst(),
      tenantClient.plugin.findMany(),
      tenantClient.tenantSubscription.findMany(),
      tenantClient.auditLog.findMany({ take: 10000, orderBy: { timestamp: 'desc' } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      data: {
        users,
        roles: roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.name) })),
        permissions,
        config,
        plugins,
        subscriptions,
        auditLogs,
      },
    };
  }

  async completeOnboarding(tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new BadRequestException('Tenant not found');

    await this.updateTenantInBothSchemas(tenant.id, tenant.slug, {
      onboardingCompleted: true,
    });

    return { onboardingCompleted: true };
  }

  async delete(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new InternalServerErrorException('Tenant not found');
    }

    // Only allow deletion of TERMINATED or INACTIVE tenants
    if (!['TERMINATED', 'INACTIVE'].includes(tenant.status)) {
      throw new InternalServerErrorException('Only terminated or inactive tenants can be deleted.');
    }

    const schemaName = validateSchemaName(`tenant_${tenant.slug.replace(/-/g, '_')}`);

    // Listeners clean up outside the app while the tenant's data still exists (e.g. take its
    // calendars out of users' Google accounts); their failure must not block the delete
    try {
      await this.pluginEventService.emitAsync(SystemEvents.TENANT_DELETING, {
        tenantSlug: tenant.slug,
        tenantId: tenant.id,
        tenantName: tenant.name,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.warn(`Cleanup before deleting tenant ${tenant.slug} failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      // 1. Drop the tenant schema (this will cascade delete all data)
      await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

      // 2. Delete tenant from public schema
      await this.prisma.tenant.delete({
        where: { id: tenantId },
      });

      this.pluginEventService.emit(SystemEvents.TENANT_DELETED, {
        tenantSlug: tenant.slug,
        tenantId: tenant.id,
        tenantName: tenant.name,
        timestamp: new Date(),
      });

      return { message: 'Tenant deleted successfully' };
    } catch (error) {
      this.logger.error('Failed to delete tenant', error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to delete tenant');
    }
  }
}
