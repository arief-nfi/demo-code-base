import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { BATCH_DETAIL_LIMIT } from '../audit/audit.config';

// Mock PrismaClient as a proper class so `extends` works
jest.mock('@saas/database', () => {
  class MockPrismaClient {
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
    $use = jest.fn();
    $queryRaw = jest.fn();
    constructor(_opts?: any) {}
  }
  return { PrismaClient: MockPrismaClient };
});

describe('PrismaService', () => {
  let service: PrismaService;
  let configService: ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/test_db?schema=public',
          DB_POOL_SIZE: 5,
          DB_POOL_TIMEOUT: 10,
          DB_IDLE_TIMEOUT_MS: 300000,
          MAX_TENANT_CLIENTS: 3, // Low limit for testing eviction
        };
        return config[key] ?? defaultValue;
      }),
    } as any;

    service = new PrismaService(configService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getTenantClient', () => {
    it('should create a new client for a new tenant slug', () => {
      const client = service.getTenantClient('acme');
      expect(client).toBeDefined();
      expect(service.getActiveTenantCount()).toBe(1);
    });

    it('should return cached client for the same tenant slug', () => {
      const client1 = service.getTenantClient('acme');
      const client2 = service.getTenantClient('acme');
      expect(client1).toBe(client2);
      expect(service.getActiveTenantCount()).toBe(1);
    });

    it('should create separate clients for different tenant slugs', () => {
      const client1 = service.getTenantClient('acme');
      const client2 = service.getTenantClient('globex');
      expect(client1).not.toBe(client2);
      expect(service.getActiveTenantCount()).toBe(2);
    });

    it('should throw error when DATABASE_URL is not defined', () => {
      const emptyConfigService = {
        get: jest.fn(() => undefined),
      } as any;
      const svc = new PrismaService(emptyConfigService);

      expect(() => svc.getTenantClient('acme')).toThrow('DATABASE_URL is not defined');
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used client when pool is full', () => {
      // MAX_TENANT_CLIENTS is 3
      service.getTenantClient('tenant-a');
      service.getTenantClient('tenant-b');
      service.getTenantClient('tenant-c');
      expect(service.getActiveTenantCount()).toBe(3);

      // Access tenant-a again to make it recently used
      service.getTenantClient('tenant-a');

      // Adding a 4th tenant should evict tenant-b (least recently used)
      service.getTenantClient('tenant-d');
      expect(service.getActiveTenantCount()).toBe(3);
    });

    it('should report correct max tenant clients limit', () => {
      expect(service.getMaxTenantClients()).toBe(3);
    });
  });

  describe('getActiveTenantCount', () => {
    it('should return 0 when no tenants are connected', () => {
      expect(service.getActiveTenantCount()).toBe(0);
    });

    it('should return the correct count of active tenant clients', () => {
      service.getTenantClient('tenant-1');
      service.getTenantClient('tenant-2');
      expect(service.getActiveTenantCount()).toBe(2);
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect all tenant clients', async () => {
      service.getTenantClient('tenant-1');
      service.getTenantClient('tenant-2');
      expect(service.getActiveTenantCount()).toBe(2);

      await service.onModuleDestroy();
      expect(service.getActiveTenantCount()).toBe(0);
    });
  });
});

// ─── Audit Middleware: Batch Detail Capture ────────────────────────

describe('PrismaService — audit middleware batch operations', () => {
  let service: PrismaService;
  let configService: ConfigService;
  let middlewareFn: (params: any, next: any) => Promise<any>;
  let auditCallback: jest.Mock;
  let mockFindMany: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/test_db?schema=public',
          MAX_TENANT_CLIENTS: 3,
        };
        return config[key] ?? defaultValue;
      }),
    } as any;

    service = new PrismaService(configService);

    // Set up audit callback to capture audit data
    auditCallback = jest.fn().mockResolvedValue(undefined);
    service.setAuditCallback(auditCallback);

    // Directly call enableAuditMiddleware to register without starting cleanup interval
    (service as any).enableAuditMiddleware(service);

    // Capture the middleware function registered via $use
    const $useMock = (service as any).$use as jest.Mock;
    middlewareFn = $useMock.mock.calls[0][0];

    // Set up mock model delegates on the service instance
    mockFindMany = jest.fn().mockResolvedValue([]);
    (service as any).user = {
      findMany: mockFindMany,
      findUnique: jest.fn().mockResolvedValue(null),
    };
  });

  /**
   * Helper: invoke the middleware and flush the setImmediate audit queue.
   */
  async function runMiddleware(params: any, result: any = { count: 3 }): Promise<any> {
    const next = jest.fn().mockResolvedValue(result);
    const returned = await middlewareFn(params, next);
    // Flush setImmediate so queueAuditLog fires
    await new Promise((r) => setImmediate(r));
    return returned;
  }

  // ─── deleteMany ───────────────────────────────────────────────

  describe('deleteMany', () => {
    it('should pre-query IDs and include them in audit changes', async () => {
      const deletedRecords = [{ id: 'u-1' }, { id: 'u-2' }, { id: 'u-3' }];
      mockFindMany.mockResolvedValue(deletedRecords);

      await runMiddleware({
        action: 'deleteMany',
        model: 'User',
        args: { where: { isActive: false } },
      });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { isActive: false },
        select: { id: true },
      });

      expect(auditCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          entity: 'User',
          entityId: 'batch',
          changes: {
            before: {
              count: 3,
              ids: ['u-1', 'u-2', 'u-3'],
            },
          },
        }),
      );
    });

    it('should truncate IDs when exceeding BATCH_DETAIL_LIMIT', async () => {
      const manyRecords = Array.from({ length: 150 }, (_, i) => ({ id: `u-${i}` }));
      mockFindMany.mockResolvedValue(manyRecords);

      await runMiddleware({
        action: 'deleteMany',
        model: 'User',
        args: { where: {} },
      }, { count: 150 });

      expect(auditCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            before: {
              count: 150,
              ids: manyRecords.slice(0, BATCH_DETAIL_LIMIT).map((r) => r.id),
              truncated: true,
              truncatedMessage: `Showing first ${BATCH_DETAIL_LIMIT} of 150 records`,
            },
          },
        }),
      );
    });

    it('should fall back to count-only when pre-query fails', async () => {
      mockFindMany.mockRejectedValue(new Error('DB error'));

      await runMiddleware({
        action: 'deleteMany',
        model: 'User',
        args: { where: {} },
      });

      expect(auditCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            before: { count: 3 },
          },
        }),
      );
    });
  });

  // ─── updateMany ───────────────────────────────────────────────

  describe('updateMany', () => {
    it('should pre-query before-state and include applied changes', async () => {
      const beforeRecords = [
        { id: 'u-1', isActive: true },
        { id: 'u-2', isActive: true },
      ];
      mockFindMany.mockResolvedValue(beforeRecords);

      await runMiddleware({
        action: 'updateMany',
        model: 'User',
        args: {
          where: { isActive: true },
          data: { isActive: false },
        },
      }, { count: 2 });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: { id: true, isActive: true },
      });

      expect(auditCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entity: 'User',
          entityId: 'batch',
          changes: {
            before: {
              records: [
                { id: 'u-1', isActive: true },
                { id: 'u-2', isActive: true },
              ],
            },
            after: {
              count: 2,
              appliedChanges: { isActive: false },
            },
          },
        }),
      );
    });

    it('should truncate before-records when exceeding BATCH_DETAIL_LIMIT', async () => {
      const manyRecords = Array.from({ length: 120 }, (_, i) => ({
        id: `u-${i}`,
        isActive: true,
      }));
      mockFindMany.mockResolvedValue(manyRecords);

      await runMiddleware({
        action: 'updateMany',
        model: 'User',
        args: {
          where: {},
          data: { isActive: false },
        },
      }, { count: 120 });

      const callArgs = auditCallback.mock.calls[0][0];
      expect(callArgs.changes.before.records).toHaveLength(BATCH_DETAIL_LIMIT);
      expect(callArgs.changes.before.truncated).toBe(true);
      expect(callArgs.changes.before.truncatedMessage).toContain('120');
    });

    it('should redact sensitive fields in applied changes', async () => {
      mockFindMany.mockResolvedValue([{ id: 'u-1', password: 'old-hash' }]);

      await runMiddleware({
        action: 'updateMany',
        model: 'User',
        args: {
          where: { id: 'u-1' },
          data: { password: 'new-hash' },
        },
      }, { count: 1 });

      const callArgs = auditCallback.mock.calls[0][0];
      expect(callArgs.changes.after.appliedChanges.password).toBe('[REDACTED]');
    });

    it('should redact sensitive fields in before-state records', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'u-1', password: 'old-hash', name: 'John' },
      ]);

      await runMiddleware({
        action: 'updateMany',
        model: 'User',
        args: {
          where: {},
          data: { password: 'new-hash', name: 'Jane' },
        },
      }, { count: 1 });

      const callArgs = auditCallback.mock.calls[0][0];
      expect(callArgs.changes.before.records[0].password).toBe('[REDACTED]');
      expect(callArgs.changes.before.records[0].name).toBe('John');
    });

    it('should fall back when pre-query fails', async () => {
      mockFindMany.mockRejectedValue(new Error('timeout'));

      await runMiddleware({
        action: 'updateMany',
        model: 'User',
        args: {
          where: {},
          data: { isActive: false },
        },
      }, { count: 5 });

      expect(auditCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            after: {
              count: 5,
              appliedChanges: { isActive: false },
            },
          },
        }),
      );
    });
  });

  // ─── createMany ───────────────────────────────────────────────

  describe('createMany', () => {
    it('should capture input data in audit changes', async () => {
      const inputData = [
        { name: 'Alice', email: 'alice@test.com' },
        { name: 'Bob', email: 'bob@test.com' },
      ];

      await runMiddleware({
        action: 'createMany',
        model: 'User',
        args: { data: inputData },
      }, { count: 2 });

      expect(auditCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entity: 'User',
          entityId: 'batch',
          changes: {
            after: {
              count: 2,
              data: inputData,
            },
          },
        }),
      );
    });

    it('should truncate input data when exceeding BATCH_DETAIL_LIMIT', async () => {
      const manyRecords = Array.from({ length: 110 }, (_, i) => ({
        name: `User ${i}`,
        email: `user${i}@test.com`,
      }));

      await runMiddleware({
        action: 'createMany',
        model: 'User',
        args: { data: manyRecords },
      }, { count: 110 });

      const callArgs = auditCallback.mock.calls[0][0];
      expect(callArgs.changes.after.data).toHaveLength(BATCH_DETAIL_LIMIT);
      expect(callArgs.changes.after.truncated).toBe(true);
      expect(callArgs.changes.after.truncatedMessage).toContain('110');
    });

    it('should redact sensitive fields in input data', async () => {
      const inputData = [
        { name: 'Alice', password: 'secret123' },
        { name: 'Bob', password: 'pass456' },
      ];

      await runMiddleware({
        action: 'createMany',
        model: 'User',
        args: { data: inputData },
      }, { count: 2 });

      const callArgs = auditCallback.mock.calls[0][0];
      expect(callArgs.changes.after.data[0].password).toBe('[REDACTED]');
      expect(callArgs.changes.after.data[1].password).toBe('[REDACTED]');
      expect(callArgs.changes.after.data[0].name).toBe('Alice');
    });

    it('should handle empty data array', async () => {
      await runMiddleware({
        action: 'createMany',
        model: 'User',
        args: { data: [] },
      }, { count: 0 });

      expect(auditCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            after: {
              count: 0,
              data: [],
            },
          },
        }),
      );
    });
  });

  // ─── Common batch behavior ────────────────────────────────────

  describe('common batch behavior', () => {
    it('should include metadata with operation and filter', async () => {
      mockFindMany.mockResolvedValue([{ id: 'u-1' }]);

      await runMiddleware({
        action: 'deleteMany',
        model: 'User',
        args: { where: { isActive: false } },
      });

      expect(auditCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            operation: 'deleteMany',
            model: 'User',
            filter: { isActive: false },
          }),
        }),
      );
    });

    it('should not audit batch operations on excluded models', async () => {
      await runMiddleware({
        action: 'deleteMany',
        model: 'AuditLog',
        args: { where: {} },
      });

      expect(auditCallback).not.toHaveBeenCalled();
    });
  });
});
