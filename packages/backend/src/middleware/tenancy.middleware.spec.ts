import { UnauthorizedException } from '@nestjs/common';
import { TenancyMiddleware, isTenantInactive } from './tenancy.middleware';

function createMockCache() {
  const store = new Map<string, any>();
  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: any) => { store.set(key, value); return Promise.resolve(); }),
    del: jest.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
    delPattern: jest.fn(),
    getStats: jest.fn(() => ({ size: store.size, backend: 'memory' as const })),
    isRedisConnected: jest.fn(() => false),
    onModuleDestroy: jest.fn(),
  };
}

describe('TenancyMiddleware', () => {
  let middleware: TenancyMiddleware;
  let mockPrisma: any;
  let mockCache: ReturnType<typeof createMockCache>;
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      tenant: {
        findUnique: jest.fn(),
      },
    };

    mockCache = createMockCache();

    middleware = new TenancyMiddleware(mockPrisma, mockCache as any);

    mockReq = {
      headers: {},
    };
    mockRes = {};
    mockNext = jest.fn();
  });

  it('should call next without setting tenant when x-tenant-id header is missing', async () => {
    await middleware.use(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.tenant).toBeUndefined();
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException when tenant is not found', async () => {
    mockReq.headers['x-tenant-id'] = 'non-existent-id';
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(middleware.use(mockReq, mockRes, mockNext)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(middleware.use(mockReq, mockRes, mockNext)).rejects.toThrow(
      'Tenant not found',
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException when tenant is inactive', async () => {
    mockReq.headers['x-tenant-id'] = 'tenant-123';
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-123',
      slug: 'acme',
      name: 'Acme Corp',
      status: 'INACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(middleware.use(mockReq, mockRes, mockNext)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(middleware.use(mockReq, mockRes, mockNext)).rejects.toThrow(
      'Tenant is inactive',
    );
  });

  it('should set req.tenant and call next for active tenant', async () => {
    const now = new Date();
    mockReq.headers['x-tenant-id'] = 'tenant-123';
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-123',
      slug: 'acme',
      name: 'Acme Corp',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });

    await middleware.use(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.tenant).toEqual({
      id: 'tenant-123',
      slug: 'acme',
      name: 'Acme Corp',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
  });

  it('should query tenant by the provided x-tenant-id', async () => {
    mockReq.headers['x-tenant-id'] = 'specific-uuid';
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'specific-uuid',
      slug: 'test',
      name: 'Test',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await middleware.use(mockReq, mockRes, mockNext);

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 'specific-uuid' },
    });
  });
});

// Shared with AuthService (login + refresh): users of these tenants get a 401 from the
// middleware, so refresh must not keep issuing tokens for them or /login ↔ / reloads forever.
describe('isTenantInactive', () => {
  it.each(['INACTIVE', 'PENDING', 'SOMETHING_NEW'])('%s is inactive (middleware answers 401)', (status) => {
    expect(isTenantInactive(status)).toBe(true);
  });

  it.each(['ACTIVE', 'TRIAL', 'SUSPENDED', 'TERMINATED'])('%s is not inactive (allowed, or a 403 status page)', (status) => {
    expect(isTenantInactive(status)).toBe(false);
  });

  it('agrees with the middleware for every status', async () => {
    for (const status of ['ACTIVE', 'TRIAL', 'SUSPENDED', 'TERMINATED', 'INACTIVE', 'PENDING', 'SOMETHING_NEW']) {
      const prisma = { tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't', slug: 'acme', name: 'Acme', status, createdAt: new Date(), updatedAt: new Date() }) } };
      const middleware = new TenancyMiddleware(prisma as any, createMockCache() as any);
      const outcome = await middleware
        .use({ headers: { 'x-tenant-id': 't' } } as any, {} as any, jest.fn())
        .then(() => 'next', (err) => (err instanceof UnauthorizedException ? '401' : 'other'));
      expect([status, outcome === '401']).toEqual([status, isTenantInactive(status)]);
    }
  });
});
