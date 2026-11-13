import { InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { SystemEvents } from '@saas/backend';
import * as bcrypt from 'bcrypt';

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(() => jest.fn().mockResolvedValue({ stdout: '', stderr: '' })),
}));

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

describe('TenantsService', () => {
  let service: TenantsService;
  let mockPrisma: any;
  let mockConfigService: any;
  let mockEmail: { send: jest.Mock };
  let mockPluginEventService: any;
  let mockTenantClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTenantClient = {
      tenant: {
        create: jest.fn().mockResolvedValue({}),
      },
      permission: {
        createMany: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          { id: 'perm-1', name: 'system.user.read' },
          { id: 'perm-2', name: 'system.user.write' },
        ]),
      },
      role: {
        create: jest.fn().mockResolvedValue({ id: 'role-admin', name: 'ADMIN' }),
      },
      user: {
        create: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
    };

    mockPrisma = {
      tenant: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $executeRawUnsafe: jest.fn(),
      getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/test_db?schema=public',
          BCRYPT_SALT_ROUNDS: 10,
          FRONTEND_URL: 'http://web.test',
        };
        return config[key] ?? defaultValue;
      }),
    };

    mockEmail = { send: jest.fn().mockResolvedValue({ messageId: 'm1', status: 'QUEUED' }) };

    mockPluginEventService = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue(undefined),
    };

    service = new TenantsService(mockPrisma, mockConfigService, mockEmail as any, mockPluginEventService);
  });

  describe('findAll', () => {
    it('should return all tenants', async () => {
      const tenants = [{ id: '1', name: 'Acme', slug: 'acme' }];
      mockPrisma.tenant.findMany.mockResolvedValue(tenants);

      const result = await service.findAll();
      expect(result).toEqual(tenants);
    });
  });

  describe('create', () => {
    it('should create tenant in public schema', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'Acme Corp',
        slug: 'acme',
      });

      await service.create({
        name: 'Acme Corp',
        slug: 'acme',
        adminEmail: 'admin@acme.com',
        adminUsername: 'admin',
      } as any);

      expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
        data: { name: 'Acme Corp', slug: 'acme' },
      });
    });

    it('should create schema with validated name', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'Acme',
        slug: 'acme',
      });

      await service.create({
        name: 'Acme',
        slug: 'acme',
      } as any);

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'CREATE SCHEMA IF NOT EXISTS "tenant_acme"',
      );
    });

    it('should convert hyphens to underscores in schema name', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'My Company',
        slug: 'my-company',
      });

      await service.create({
        name: 'My Company',
        slug: 'my-company',
      } as any);

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'CREATE SCHEMA IF NOT EXISTS "tenant_my_company"',
      );
    });

    it('should seed permissions including plugin permissions', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'Test',
        slug: 'test',
      });

      await service.create({
        name: 'Test',
        slug: 'test',
      } as any);

      expect(mockTenantClient.permission.createMany).toHaveBeenCalled();
      const createManyCall = mockTenantClient.permission.createMany.mock.calls[0][0];
      const permNames = createManyCall.data.map((p: any) => p.name);

      // Should include system permissions
      expect(permNames).toContain('system.user.read');
      expect(permNames).toContain('system.user.write');
      expect(permNames).toContain('system.role.read');
      expect(permNames).toContain('system.role.write');
    });

    it('should create ADMIN and USER roles', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'Test',
        slug: 'test',
      });

      await service.create({
        name: 'Test',
        slug: 'test',
      } as any);

      // Should have created ADMIN and USER roles (not SYSADMIN since slug != 'system')
      const roleCreateCalls = mockTenantClient.role.create.mock.calls;
      expect(roleCreateCalls.length).toBe(2);

      const roleNames = roleCreateCalls.map((call: any) => call[0].data.name);
      expect(roleNames).toContain('ADMIN');
      expect(roleNames).toContain('USER');
    });

    it('should create the USER role with no permissions (tenant admins assign them) and give ADMIN all', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'Test',
        slug: 'test',
      });
      mockTenantClient.permission.findMany.mockResolvedValue([
        { id: 'p-user-read', name: 'system.user.read' },
        { id: 'p-user-write', name: 'system.user.write' },
        { id: 'p-wf-view', name: 'system.workflow.view' },
        { id: 'p-wf-manage', name: 'system.workflow.manage' },
        { id: 'p-item-read', name: 'sample-plugin.item.read' },
        { id: 'p-item-write', name: 'sample-plugin.item.write' },
        { id: 'p-log-view', name: 'audit-log.log.view' },
        { id: 'p-log-export', name: 'audit-log.log.export' },
      ]);

      await service.create({ name: 'Test', slug: 'test' } as any);

      const roleCall = (name: string) =>
        mockTenantClient.role.create.mock.calls.find((call: any) => call[0].data.name === name)[0];
      expect(roleCall('USER').data.permissions).toBeUndefined();
      expect(roleCall('ADMIN').data.permissions.connect).toEqual([
        { id: 'p-user-read' },
        { id: 'p-user-write' },
        { id: 'p-wf-view' },
        { id: 'p-wf-manage' },
        { id: 'p-item-read' },
        { id: 'p-item-write' },
        { id: 'p-log-view' },
        { id: 'p-log-export' },
      ]);
    });
  });

  it('new tenants get system.email.read and system.email.write', async () => {
    mockPrisma.tenant.create.mockResolvedValue({ id: 'tenant-id', name: 'Acme Corp', slug: 'acme' });

    await service.create({ name: 'Acme Corp', slug: 'acme', adminEmail: 'admin@acme.com' } as any);

    const names = (mockTenantClient.permission.createMany.mock.calls[0][0].data as Array<{ name: string }>).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['system.email.read', 'system.email.write']));
  });

  describe('lifecycle emails', () => {
    const tenant = { id: 't1', name: 'Acme Corp', slug: 'acme', status: 'ACTIVE' };

    beforeEach(() => {
      jest.spyOn(service as any, 'updateTenantInBothSchemas').mockResolvedValue(undefined);
      mockTenantClient.user.findFirst = jest.fn().mockResolvedValue({ email: 'boss@acme.test' });
    });

    it('welcome: a new tenant admin gets core.tenant-welcome with a setup link', async () => {
      mockPrisma.tenant.create.mockResolvedValue(tenant);

      await service.create({ name: 'Acme Corp', slug: 'acme', adminEmail: 'boss@acme.test', adminUsername: 'boss' } as any);

      expect(mockEmail.send).toHaveBeenCalledWith({
        template: 'core.tenant-welcome',
        tenantSlug: 'acme',
        to: 'boss@acme.test',
        data: {
          tenantName: 'Acme Corp',
          username: 'boss@acme',
          setupUrl: expect.stringMatching(/^http:\/\/web\.test\/reset-password\?token=[0-9a-f]{64}&tenant=acme$/),
        },
      });
    });

    it('suspended: the tenant admin gets core.tenant-suspended with the reason', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);

      await service.suspendTenant('t1', 'Unpaid invoices');

      expect(mockEmail.send).toHaveBeenCalledWith({
        template: 'core.tenant-suspended', tenantSlug: 'acme', to: 'boss@acme.test', data: { tenantName: 'Acme Corp', reason: 'Unpaid invoices' },
      });
    });

    it('reactivated: the tenant admin gets core.tenant-reactivated with the login link', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ ...tenant, status: 'SUSPENDED' });

      await service.reactivateTenant('t1');

      expect(mockEmail.send).toHaveBeenCalledWith({
        template: 'core.tenant-reactivated', tenantSlug: 'acme', to: 'boss@acme.test', data: { tenantName: 'Acme Corp', loginUrl: 'http://web.test/login' },
      });
    });

    it('terminated: the tenant admin gets core.tenant-terminated with the deletion date', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);

      await service.terminateTenant('t1', 30);

      expect(mockEmail.send).toHaveBeenCalledWith({
        template: 'core.tenant-terminated', tenantSlug: 'acme', to: 'boss@acme.test', data: { tenantName: 'Acme Corp', terminationDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      });
    });

    it('a failing email never fails the lifecycle action', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);
      mockEmail.send.mockRejectedValue(new Error('db down'));

      await expect(service.suspendTenant('t1', 'x')).resolves.toBeDefined();
    });
  });

  describe('create — the seeded system admin', () => {
    it('gets the password the seed passes: no reset token, no setup link, no welcome email', async () => {
      mockPrisma.tenant.create.mockResolvedValue({ id: 't-sys', name: 'System', slug: 'system' });
      const log = jest.spyOn((service as any).logger, 'log');

      await service.create({ name: 'System', slug: 'system', adminUsername: 'admin' }, 'from-the-env-1');

      expect(bcrypt.hash).toHaveBeenCalledWith('from-the-env-1', 10);
      const data = mockTenantClient.user.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ username: 'admin', email: 'admin@system.com', password: 'hashed-password' });
      expect(data.resetPasswordToken ?? null).toBeNull();
      expect(data.resetPasswordExpires ?? null).toBeNull();
      expect(mockEmail.send).not.toHaveBeenCalled();
      const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain('reset-password');
      expect(logged).not.toContain('from-the-env-1');
    });

    it('any other new admin still gets a random password and a 24-hour setup token', async () => {
      mockPrisma.tenant.create.mockResolvedValue({ id: 't1', name: 'Acme Corp', slug: 'acme' });

      await service.create({ name: 'Acme Corp', slug: 'acme', adminEmail: 'boss@acme.test' } as any);

      expect(bcrypt.hash).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/), 10);
      const data = mockTenantClient.user.create.mock.calls[0][0].data;
      expect(data.resetPasswordToken).toMatch(/^[0-9a-f]{64}$/);
      expect(data.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    });
  });

  describe('create — compensating cleanup on failure', () => {
    it('should drop schema and delete tenant record when provisioning fails', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'Fail Corp',
        slug: 'fail',
      });

      // Fail during permission seeding
      mockTenantClient.permission.createMany.mockRejectedValue(new Error('DB error'));
      mockPrisma.tenant.delete.mockResolvedValue({});

      await expect(
        service.create({ name: 'Fail Corp', slug: 'fail' } as any),
      ).rejects.toThrow(InternalServerErrorException);

      // Should have attempted cleanup
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'DROP SCHEMA IF EXISTS "tenant_fail" CASCADE',
      );
      expect(mockPrisma.tenant.delete).toHaveBeenCalledWith({
        where: { id: 'tenant-id' },
      });
    });

    it('should still throw even if cleanup itself fails', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'Fail Corp',
        slug: 'fail',
      });

      // Fail during role creation
      mockTenantClient.role.create.mockRejectedValue(new Error('Role creation failed'));

      // Cleanup also fails
      mockPrisma.$executeRawUnsafe
        .mockResolvedValueOnce(undefined) // CREATE SCHEMA succeeds
        .mockRejectedValueOnce(new Error('DROP failed')); // DROP SCHEMA fails
      mockPrisma.tenant.delete.mockRejectedValue(new Error('Delete failed'));

      await expect(
        service.create({ name: 'Fail Corp', slug: 'fail' } as any),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should not cleanup when tenant creation in public schema fails', async () => {
      mockPrisma.tenant.create.mockRejectedValue(new Error('Unique constraint'));

      await expect(
        service.create({ name: 'Dup', slug: 'dup' } as any),
      ).rejects.toThrow();

      // No schema should have been created or dropped
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should throw error when tenant is not found', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.delete('non-existent')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw error when tenant is not TERMINATED or INACTIVE', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-id',
        slug: 'acme',
        status: 'ACTIVE',
      });

      await expect(service.delete('tenant-id')).rejects.toThrow(
        'Only terminated or inactive tenants can be deleted.',
      );
    });

    it('should drop schema and delete tenant when INACTIVE', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-id',
        slug: 'acme',
        status: 'INACTIVE',
      });
      mockPrisma.tenant.delete.mockResolvedValue({});

      const result = await service.delete('tenant-id');

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'DROP SCHEMA IF EXISTS "tenant_acme" CASCADE',
      );
      expect(mockPrisma.tenant.delete).toHaveBeenCalledWith({
        where: { id: 'tenant-id' },
      });
      expect(result).toEqual({ message: 'Tenant deleted successfully' });
    });
  });

  describe('delete: cleanup before the schema is dropped', () => {
    beforeEach(() => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-id', slug: 'acme', name: 'Acme', status: 'TERMINATED' });
      mockPrisma.tenant.delete.mockResolvedValue({});
    });

    it('awaits TENANT_DELETING listeners before dropping the schema', async () => {
      await service.delete('tenant-id');

      expect(mockPluginEventService.emitAsync).toHaveBeenCalledWith(
        SystemEvents.TENANT_DELETING,
        expect.objectContaining({ tenantSlug: 'acme', tenantId: 'tenant-id' }),
      );
      expect(mockPluginEventService.emitAsync.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.$executeRawUnsafe.mock.invocationCallOrder[0],
      );
    });

    it('a failing cleanup does not block the delete', async () => {
      mockPluginEventService.emitAsync.mockRejectedValueOnce(new Error('listener failed'));

      await expect(service.delete('tenant-id')).resolves.toEqual({ message: 'Tenant deleted successfully' });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalled();
    });
  });

  describe('schema name validation', () => {
    it('should reject schema names with SQL injection characters', async () => {
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-id',
        name: 'Evil',
        slug: 'evil"; DROP TABLE users; --',
      });

      await expect(
        service.create({ name: 'Evil', slug: 'evil"; DROP TABLE users; --' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
