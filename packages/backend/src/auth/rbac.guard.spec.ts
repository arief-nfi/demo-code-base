import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacGuard } from './rbac.guard';
import { ROLES_KEY, PERMISSIONS_KEY, RBAC_MODE_KEY } from './rbac.decorator';

describe('RbacGuard', () => {
  let guard: RbacGuard;
  let reflector: Reflector;

  const mockTenantClient = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockPrismaService = {
    user: { findUnique: jest.fn() },
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  function createMockContext(user?: { userId: string; tenantSlug?: string }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn() as any,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
    guard = new RbacGuard(reflector, mockPrismaService as any);
  });

  it('should allow access when no roles or permissions are required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user is not present', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === ROLES_KEY) return ['ADMIN'];
      return undefined;
    });
    const context = createMockContext(undefined);

    expect(await guard.canActivate(context)).toBe(false);
  });

  it('should deny access when user is not found in database', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === ROLES_KEY) return ['ADMIN'];
      return undefined;
    });
    mockTenantClient.user.findUnique.mockResolvedValue(null);
    const context = createMockContext({ userId: 'nonexistent', tenantSlug: 'acme' });

    expect(await guard.canActivate(context)).toBe(false);
  });

  it('should always grant access to SYSADMIN users', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === ROLES_KEY) return ['ADMIN'];
      return undefined;
    });
    mockTenantClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'SYSADMIN', permissions: [] }],
    });
    const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should grant access when user has required role', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === ROLES_KEY) return ['ADMIN'];
      return undefined;
    });
    mockTenantClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'ADMIN', permissions: [] }],
    });
    const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user lacks required role', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === ROLES_KEY) return ['ADMIN'];
      return undefined;
    });
    mockTenantClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'USER', permissions: [] }],
    });
    const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

    expect(await guard.canActivate(context)).toBe(false);
  });

  it('should grant access when user has required permission', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === PERMISSIONS_KEY) return ['system.user.read'];
      return undefined;
    });
    mockTenantClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'USER', permissions: [{ name: 'system.user.read' }] }],
    });
    const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user lacks required permission', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === PERMISSIONS_KEY) return ['system.user.write'];
      return undefined;
    });
    mockTenantClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'USER', permissions: [{ name: 'system.user.read' }] }],
    });
    const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

    expect(await guard.canActivate(context)).toBe(false);
  });

  it('should do case-insensitive role comparison', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === ROLES_KEY) return ['admin'];
      return undefined;
    });
    mockTenantClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'ADMIN', permissions: [] }],
    });
    const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

    expect(await guard.canActivate(context)).toBe(true);
  });

  describe('OR mode (default)', () => {
    it('should grant access when user has role but not permission', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return ['ADMIN'];
        if (key === PERMISSIONS_KEY) return ['some.other.perm'];
        if (key === RBAC_MODE_KEY) return 'OR';
        return undefined;
      });
      mockTenantClient.user.findUnique.mockResolvedValue({
        id: 'user-1',
        roles: [{ name: 'ADMIN', permissions: [] }],
      });
      const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

      expect(await guard.canActivate(context)).toBe(true);
    });
  });

  describe('AND mode', () => {
    it('should deny access when user has role but not permission', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return ['ADMIN'];
        if (key === PERMISSIONS_KEY) return ['some.other.perm'];
        if (key === RBAC_MODE_KEY) return 'AND';
        return undefined;
      });
      mockTenantClient.user.findUnique.mockResolvedValue({
        id: 'user-1',
        roles: [{ name: 'ADMIN', permissions: [] }],
      });
      const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

      expect(await guard.canActivate(context)).toBe(false);
    });

    it('should grant access when user has both role and permission', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return ['ADMIN'];
        if (key === PERMISSIONS_KEY) return ['system.user.read'];
        if (key === RBAC_MODE_KEY) return 'AND';
        return undefined;
      });
      mockTenantClient.user.findUnique.mockResolvedValue({
        id: 'user-1',
        roles: [{ name: 'ADMIN', permissions: [{ name: 'system.user.read' }] }],
      });
      const context = createMockContext({ userId: 'user-1', tenantSlug: 'acme' });

      expect(await guard.canActivate(context)).toBe(true);
    });
  });
});
