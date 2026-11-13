import { AuditService, AuditLogData } from './audit.service';
import { computeAuditHash } from './audit.config';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

const mockAuditLogCreate = jest.fn();
const mockAuditLogFindFirst = jest.fn();
const mockAuditLogFindMany = jest.fn();
const mockAuditLogCount = jest.fn();
const mockAuditLogDeleteMany = jest.fn();

const mockTenantClient = {
  auditLog: {
    create: mockAuditLogCreate,
    findFirst: mockAuditLogFindFirst,
    findMany: mockAuditLogFindMany,
    count: mockAuditLogCount,
    deleteMany: mockAuditLogDeleteMany,
  },
};

const mockPrisma = {
  auditLog: {
    create: mockAuditLogCreate,
    findFirst: mockAuditLogFindFirst,
    findMany: mockAuditLogFindMany,
    count: mockAuditLogCount,
    deleteMany: mockAuditLogDeleteMany,
  },
  getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  setAuditCallback: jest.fn(),
  setAuditConfigService: jest.fn(),
};

describe('AuditService', () => {
  let service: AuditService;

  const baseAuditData: AuditLogData = {
    action: 'CREATE',
    entity: 'User',
    entityId: 'user-123',
    userId: 'admin-1',
    tenantSlug: 'acme',
    changes: { after: { name: 'John', email: 'john@test.com' } },
    metadata: { requestIp: '127.0.0.1', userAgent: 'jest' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.appendFileSync.mockImplementation(() => undefined);
    mockFs.writeFileSync.mockImplementation(() => undefined);
    mockFs.mkdirSync.mockImplementation(() => undefined as any);
    mockAuditLogFindFirst.mockResolvedValue(null);
    const mockAuditConfigService = {
      getSensitiveFields: jest.fn().mockReturnValue({ '*': [] }),
      getIgnoredFields: jest.fn().mockReturnValue({ '*': [] }),
      getEntityFilter: jest.fn().mockReturnValue({ exclude: ['AuditLog'] }),
      getConfig: jest.fn().mockResolvedValue({ sensitiveFields: {}, ignoredFields: {}, entityFilter: null }),
      saveConfig: jest.fn(),
      ensureLoaded: jest.fn(),
    };
    service = new AuditService(mockPrisma as any, mockAuditConfigService as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── onModuleInit ──────────────────────────────────────

  describe('onModuleInit', () => {
    it('should register audit callback on PrismaService', () => {
      service.onModuleInit();
      expect(mockPrisma.setAuditCallback).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should pass a callback that calls log()', async () => {
      service.onModuleInit();
      const callback = mockPrisma.setAuditCallback.mock.calls[0][0];
      mockAuditLogCreate.mockResolvedValueOnce({});

      await callback(baseAuditData);
      expect(mockAuditLogCreate).toHaveBeenCalled();
    });
  });

  // ─── log() ─────────────────────────────────────────────

  describe('log', () => {
    it('should create an audit log entry in the tenant database', async () => {
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'log-1' });

      await service.log(baseAuditData);

      expect(mockPrisma.getTenantClient).toHaveBeenCalledWith('acme');
      expect(mockAuditLogFindFirst).toHaveBeenCalledWith({
        where: { tenantSlug: 'acme' },
        orderBy: { timestamp: 'desc' },
        select: { hash: true },
      });
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          action: 'CREATE',
          entity: 'User',
          entityId: 'user-123',
          userId: 'admin-1',
          tenantSlug: 'acme',
          changes: baseAuditData.changes,
          metadata: baseAuditData.metadata,
          previousHash: null,
          hash: expect.any(String),
          timestamp: expect.any(Date),
        },
      });
    });

    it('should use main prisma client when tenantSlug is undefined', async () => {
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'log-1' });

      await service.log({ ...baseAuditData, tenantSlug: undefined });

      expect(mockPrisma.getTenantClient).not.toHaveBeenCalled();
      expect(mockAuditLogCreate).toHaveBeenCalled();
    });

    it('should handle missing optional fields', async () => {
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'log-1' });

      const minimalData: AuditLogData = {
        action: 'DELETE',
        entity: 'Role',
        entityId: 'role-1',
      };
      await service.log(minimalData);

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DELETE',
          entity: 'Role',
          entityId: 'role-1',
          userId: undefined,
          tenantSlug: undefined,
          changes: undefined,
          metadata: undefined,
          previousHash: null,
          hash: expect.any(String),
          timestamp: expect.any(Date),
        }),
      });
    });

    it('should succeed on first attempt without retrying', async () => {
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'log-1' });

      await service.log(baseAuditData);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    });

    // ─── Retry logic ───────────────────────────────────

    describe('retry logic', () => {
      it('should retry on transient failure and succeed on second attempt', async () => {
        mockAuditLogCreate
          .mockRejectedValueOnce(new Error('connection reset'))
          .mockResolvedValueOnce({ id: 'log-1' });

        const logPromise = service.log(baseAuditData);
        // Advance past the first backoff (100ms)
        await jest.advanceTimersByTimeAsync(100);
        await logPromise;

        expect(mockAuditLogCreate).toHaveBeenCalledTimes(2);
        expect(mockFs.appendFileSync).not.toHaveBeenCalled();
      });

      it('should retry on transient failure and succeed on third attempt', async () => {
        mockAuditLogCreate
          .mockRejectedValueOnce(new Error('connection reset'))
          .mockRejectedValueOnce(new Error('timeout'))
          .mockResolvedValueOnce({ id: 'log-1' });

        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(100); // first backoff
        await jest.advanceTimersByTimeAsync(200); // second backoff
        await logPromise;

        expect(mockAuditLogCreate).toHaveBeenCalledTimes(3);
        expect(mockFs.appendFileSync).not.toHaveBeenCalled();
      });

      it('should write to fallback file after all retries exhausted', async () => {
        mockAuditLogCreate
          .mockRejectedValueOnce(new Error('fail 1'))
          .mockRejectedValueOnce(new Error('fail 2'))
          .mockRejectedValueOnce(new Error('fail 3'));

        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(100);
        await jest.advanceTimersByTimeAsync(200);
        await logPromise;

        expect(mockAuditLogCreate).toHaveBeenCalledTimes(3);
        expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
      });

      it('should increment failure count on final failure', async () => {
        mockAuditLogCreate.mockRejectedValue(new Error('persistent failure'));

        expect(service.getFailureCount()).toBe(0);

        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(300);
        await logPromise;

        expect(service.getFailureCount()).toBe(1);
      });

      it('should use exponential backoff timing (100ms, 200ms)', async () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        mockAuditLogCreate.mockRejectedValue(new Error('fail'));

        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(300);
        await logPromise;

        // First retry: 2^0 * 100 = 100ms, second retry: 2^1 * 100 = 200ms
        const timeoutCalls = setTimeoutSpy.mock.calls
          .map((call) => call[1])
          .filter((ms) => ms !== undefined);
        expect(timeoutCalls).toContain(100);
        expect(timeoutCalls).toContain(200);
        setTimeoutSpy.mockRestore();
      });
    });

    // ─── Fallback file ─────────────────────────────────

    describe('fallback file', () => {
      beforeEach(() => {
        mockAuditLogCreate.mockRejectedValue(new Error('db down'));
      });

      it('should create the fallback directory if it does not exist', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(300);
        await logPromise;

        expect(mockFs.mkdirSync).toHaveBeenCalledWith(
          expect.stringContaining(path.join('backups', 'audit-fallback')),
          { recursive: true },
        );
      });

      it('should not create the directory if it already exists', async () => {
        mockFs.existsSync.mockReturnValue(true);

        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(300);
        await logPromise;

        expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      });

      it('should write JSONL entry with correct filename pattern', async () => {
        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(300);
        await logPromise;

        expect(mockFs.appendFileSync).toHaveBeenCalledWith(
          expect.stringMatching(/audit-fallback-\d{4}-\d{2}-\d{2}\.jsonl$/),
          expect.any(String),
          'utf-8',
        );
      });

      it('should write valid JSONL content with failedAt timestamp', async () => {
        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(300);
        await logPromise;

        const writtenContent = mockFs.appendFileSync.mock.calls[0][1] as string;
        expect(writtenContent.endsWith('\n')).toBe(true);

        const parsed = JSON.parse(writtenContent.trim());
        expect(parsed.action).toBe('CREATE');
        expect(parsed.entity).toBe('User');
        expect(parsed.entityId).toBe('user-123');
        expect(parsed.failedAt).toBeDefined();
        expect(new Date(parsed.failedAt).getTime()).not.toBeNaN();
      });

      it('should not throw when fallback file write itself fails', async () => {
        mockFs.appendFileSync.mockImplementation(() => {
          throw new Error('disk full');
        });

        const logPromise = service.log(baseAuditData);
        await jest.advanceTimersByTimeAsync(300);

        // Should not throw — silently logs the error
        await expect(logPromise).resolves.toBeUndefined();
      });
    });
  });

  // ─── query() ───────────────────────────────────────────

  describe('query', () => {
    const mockLogs = [
      { id: 'log-1', action: 'CREATE', entity: 'User', entityId: 'u-1', timestamp: new Date(), user: { id: 'u-1', name: 'Admin', email: 'admin@test.com' } },
      { id: 'log-2', action: 'UPDATE', entity: 'User', entityId: 'u-1', timestamp: new Date(), user: { id: 'u-1', name: 'Admin', email: 'admin@test.com' } },
    ];

    beforeEach(() => {
      mockAuditLogFindMany.mockResolvedValue(mockLogs);
      mockAuditLogCount.mockResolvedValue(2);
    });

    it('should return paginated results with correct metadata', async () => {
      const result = await service.query('acme', {});

      expect(result).toEqual({
        logs: mockLogs,
        pagination: {
          total: 2,
          page: 1,
          limit: 10,
          pages: 1,
        },
      });
    });

    it('should use default page=1 and limit=10', async () => {
      await service.query('acme', {});

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });

    it('should apply custom pagination', async () => {
      mockAuditLogCount.mockResolvedValue(50);

      const result = await service.query('acme', { page: 3, limit: 5 });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10, // (3-1) * 5
          take: 5,
        }),
      );
      expect(result.pagination.pages).toBe(10); // 50/5
    });

    it('should filter by entity (case-insensitive contains)', async () => {
      await service.query('acme', { entity: 'User' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entity: { contains: 'User', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should filter by entityId (case-insensitive contains)', async () => {
      await service.query('acme', { entityId: 'user-123' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityId: { contains: 'user-123', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should filter by userId', async () => {
      await service.query('acme', { userId: 'admin-1' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'admin-1' }),
        }),
      );
    });

    it('should filter by action', async () => {
      await service.query('acme', { action: 'DELETE' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: 'DELETE' }),
        }),
      );
    });

    it('should search by username (case-insensitive)', async () => {
      await service.query('acme', { search: 'admin' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: { name: { contains: 'admin', mode: 'insensitive' } },
          }),
        }),
      );
    });

    it('should filter by startDate and endDate', async () => {
      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-03-01');

      await service.query('acme', { startDate, endDate });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: { gte: startDate, lte: endDate },
          }),
        }),
      );
    });

    it('should filter by startDate only', async () => {
      const startDate = new Date('2026-01-01');

      await service.query('acme', { startDate });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: { gte: startDate },
          }),
        }),
      );
    });

    it('should filter by endDate only', async () => {
      const endDate = new Date('2026-03-01');

      await service.query('acme', { endDate });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: { lte: endDate },
          }),
        }),
      );
    });

    it('should sort by timestamp desc by default', async () => {
      await service.query('acme', {});

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { timestamp: 'desc' },
        }),
      );
    });

    it('should sort by action asc when specified', async () => {
      await service.query('acme', { sortBy: 'action', sortOrder: 'asc' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { action: 'asc' },
        }),
      );
    });

    it('should sort by entity when specified', async () => {
      await service.query('acme', { sortBy: 'entity', sortOrder: 'desc' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { entity: 'desc' },
        }),
      );
    });

    it('should fallback to timestamp sort for invalid sortBy', async () => {
      await service.query('acme', { sortBy: 'invalid_field', sortOrder: 'asc' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { timestamp: 'asc' },
        }),
      );
    });

    it('should include user relation (id, name, email)', async () => {
      await service.query('acme', {});

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        }),
      );
    });

    it('should return empty results when no matches', async () => {
      mockAuditLogFindMany.mockResolvedValue([]);
      mockAuditLogCount.mockResolvedValue(0);

      const result = await service.query('acme', { action: 'READ' });

      expect(result.logs).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.pages).toBe(0);
    });

    it('should always filter by tenantSlug', async () => {
      await service.query('acme', {});

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantSlug: 'acme' }),
        }),
      );
    });
  });

  // ─── applyRetention() ─────────────────────────────────

  describe('applyRetention', () => {
    describe('time-based retention', () => {
      const beforeDate = new Date('2026-01-01');

      it('should delete logs older than the specified date', async () => {
        mockAuditLogFindMany.mockResolvedValue([]);
        mockAuditLogDeleteMany.mockResolvedValue({ count: 5 });

        const deleted = await service.applyRetention('acme', {
          type: 'time',
          beforeDate,
          backup: false,
        });

        expect(deleted).toBe(5);
        expect(mockAuditLogDeleteMany).toHaveBeenCalledWith({
          where: {
            tenantSlug: 'acme',
            timestamp: { lt: beforeDate },
          },
        });
      });

      it('should backup logs before deletion when backup is true', async () => {
        const logsToDelete = [
          { id: 'log-1', action: 'CREATE', entity: 'User', timestamp: new Date('2025-12-01') },
        ];
        mockAuditLogFindMany.mockResolvedValue(logsToDelete);
        mockAuditLogDeleteMany.mockResolvedValue({ count: 1 });

        await service.applyRetention('acme', {
          type: 'time',
          beforeDate,
          backup: true,
        });

        expect(mockFs.writeFileSync).toHaveBeenCalledWith(
          expect.stringMatching(/audit-backup-time-based-.+\.json$/),
          expect.any(String),
          'utf-8',
        );

        const backupContent = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(backupContent.tenantSlug).toBe('acme');
        expect(backupContent.retentionType).toBe('time-based');
        expect(backupContent.recordCount).toBe(1);
        // Dates become strings after JSON serialization
        expect(backupContent.logs).toEqual(JSON.parse(JSON.stringify(logsToDelete)));
      });

      it('should not backup when there are no logs to delete', async () => {
        mockAuditLogFindMany.mockResolvedValue([]);
        mockAuditLogDeleteMany.mockResolvedValue({ count: 0 });

        await service.applyRetention('acme', {
          type: 'time',
          beforeDate,
          backup: true,
        });

        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
      });

      it('should not backup when backup is explicitly false', async () => {
        mockAuditLogFindMany.mockResolvedValue([{ id: 'log-1' }]);
        mockAuditLogDeleteMany.mockResolvedValue({ count: 1 });

        await service.applyRetention('acme', {
          type: 'time',
          beforeDate,
          backup: false,
        });

        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
      });

      it('should create backup directory if it does not exist', async () => {
        mockFs.existsSync.mockReturnValue(false);
        mockAuditLogFindMany.mockResolvedValue([{ id: 'log-1' }]);
        mockAuditLogDeleteMany.mockResolvedValue({ count: 1 });

        await service.applyRetention('acme', {
          type: 'time',
          beforeDate,
          backup: true,
        });

        expect(mockFs.mkdirSync).toHaveBeenCalledWith(
          expect.stringContaining(path.join('backups', 'audit-logs', 'acme')),
          { recursive: true },
        );
      });
    });

    describe('count-based retention', () => {
      it('should keep N most recent records and delete the rest', async () => {
        const threshold = new Date('2026-02-01');
        mockAuditLogCount.mockResolvedValue(100);
        mockAuditLogFindMany
          .mockResolvedValueOnce([{ timestamp: threshold }]) // findMany for threshold
          .mockResolvedValueOnce([]); // findMany for backup
        mockAuditLogDeleteMany.mockResolvedValue({ count: 50 });

        const deleted = await service.applyRetention('acme', {
          type: 'count',
          keepCount: 50,
          backup: false,
        });

        expect(deleted).toBe(50);
        expect(mockAuditLogDeleteMany).toHaveBeenCalledWith({
          where: {
            tenantSlug: 'acme',
            timestamp: { lt: threshold },
          },
        });
      });

      it('should return 0 when total count is less than or equal to keepCount', async () => {
        mockAuditLogCount.mockResolvedValue(10);

        const deleted = await service.applyRetention('acme', {
          type: 'count',
          keepCount: 50,
        });

        expect(deleted).toBe(0);
        expect(mockAuditLogDeleteMany).not.toHaveBeenCalled();
      });

      it('should return 0 when keepThreshold query returns empty', async () => {
        mockAuditLogCount.mockResolvedValue(100);
        mockAuditLogFindMany.mockResolvedValueOnce([]); // no threshold found

        const deleted = await service.applyRetention('acme', {
          type: 'count',
          keepCount: 50,
          backup: false,
        });

        expect(deleted).toBe(0);
      });

      it('should backup logs before count-based deletion', async () => {
        const threshold = new Date('2026-02-01');
        const logsToDelete = [
          { id: 'log-old-1', action: 'CREATE', timestamp: new Date('2025-12-01') },
        ];
        mockAuditLogCount.mockResolvedValue(100);
        mockAuditLogFindMany
          .mockResolvedValueOnce([{ timestamp: threshold }]) // threshold
          .mockResolvedValueOnce(logsToDelete); // logs for backup
        mockAuditLogDeleteMany.mockResolvedValue({ count: 50 });

        await service.applyRetention('acme', {
          type: 'count',
          keepCount: 50,
          backup: true,
        });

        expect(mockFs.writeFileSync).toHaveBeenCalledWith(
          expect.stringMatching(/audit-backup-count-based-.+\.json$/),
          expect.any(String),
          'utf-8',
        );

        const backupContent = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(backupContent.retentionType).toBe('count-based');
      });

      it('should query threshold with correct skip and take', async () => {
        mockAuditLogCount.mockResolvedValue(100);
        mockAuditLogFindMany.mockResolvedValueOnce([{ timestamp: new Date() }]).mockResolvedValueOnce([]);
        mockAuditLogDeleteMany.mockResolvedValue({ count: 80 });

        await service.applyRetention('acme', {
          type: 'count',
          keepCount: 20,
          backup: false,
        });

        expect(mockAuditLogFindMany).toHaveBeenCalledWith({
          where: { tenantSlug: 'acme' },
          orderBy: { timestamp: 'desc' },
          skip: 19, // keepCount - 1
          take: 1,
          select: { timestamp: true },
        });
      });
    });

    describe('edge cases', () => {
      it('should return 0 for unknown retention type', async () => {
        const deleted = await service.applyRetention('acme', {
          type: 'time',
          // missing beforeDate
        });

        expect(deleted).toBe(0);
      });

      it('should throw on database error', async () => {
        mockAuditLogFindMany.mockRejectedValue(new Error('connection lost'));

        await expect(
          service.applyRetention('acme', {
            type: 'time',
            beforeDate: new Date(),
          }),
        ).rejects.toThrow('Failed to apply retention policy');
      });

      it('should not throw if backup file write fails during retention', async () => {
        mockAuditLogFindMany.mockResolvedValue([{ id: 'log-1' }]);
        mockAuditLogDeleteMany.mockResolvedValue({ count: 1 });
        mockFs.writeFileSync.mockImplementation(() => {
          throw new Error('disk full');
        });

        // Should not throw — backup failure shouldn't block deletion
        const deleted = await service.applyRetention('acme', {
          type: 'time',
          beforeDate: new Date(),
          backup: true,
        });

        expect(deleted).toBe(1);
      });
    });
  });

  // ─── queryAll() ────────────────────────────────────────

  describe('queryAll', () => {
    const mockLogs = [
      { id: 'log-1', action: 'CREATE', entity: 'User', entityId: 'u-1', timestamp: new Date(), user: { id: 'u-1', name: 'Admin', email: 'admin@test.com' } },
      { id: 'log-2', action: 'DELETE', entity: 'Role', entityId: 'r-1', timestamp: new Date(), user: { id: 'u-1', name: 'Admin', email: 'admin@test.com' } },
    ];

    beforeEach(() => {
      mockAuditLogFindMany.mockResolvedValue(mockLogs);
    });

    it('should return all logs without pagination', async () => {
      const result = await service.queryAll('acme', {});

      expect(result).toEqual(mockLogs);
      // Should NOT use skip/take pagination (only take for max cap)
      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100_000,
        }),
      );
      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.not.objectContaining({
          skip: expect.anything(),
        }),
      );
    });

    it('should apply filters same as query()', async () => {
      const startDate = new Date('2026-01-01');
      await service.queryAll('acme', {
        entity: 'User',
        action: 'CREATE',
        startDate,
        sortBy: 'action',
        sortOrder: 'asc',
      });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantSlug: 'acme',
            entity: { contains: 'User', mode: 'insensitive' },
            action: 'CREATE',
            timestamp: { gte: startDate },
          }),
          orderBy: { action: 'asc' },
        }),
      );
    });

    it('should include user relation', async () => {
      await service.queryAll('acme', {});

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        }),
      );
    });

    it('should cap results at MAX_EXPORT_RECORDS', async () => {
      await service.queryAll('acme', {});

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100_000,
        }),
      );
    });
  });

  // ─── replayFallbackLogs() ────────────────────────────

  describe('replayFallbackLogs', () => {
    const fallbackEntry = {
      action: 'CREATE',
      entity: 'User',
      entityId: 'user-1',
      userId: 'admin-1',
      tenantSlug: 'acme',
      changes: { after: { name: 'John' } },
      metadata: { requestIp: '127.0.0.1' },
      failedAt: '2026-03-01T10:00:00.000Z',
    };

    const fallbackLine = JSON.stringify(fallbackEntry) + '\n';

    it('should return zero counts when no fallback directory exists', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await service.replayFallbackLogs();

      expect(result).toEqual({ total: 0, replayed: 0, failed: 0, errors: [] });
    });

    it('should return zero counts when no .jsonl files exist', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([] as any);

      const result = await service.replayFallbackLogs();

      expect(result).toEqual({ total: 0, replayed: 0, failed: 0, errors: [] });
    });

    it('should replay entries from fallback files into the database', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['audit-fallback-2026-03-01.jsonl'] as any);
      mockFs.readFileSync.mockReturnValue(fallbackLine);
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'replayed-1' });

      const result = await service.replayFallbackLogs();

      expect(result.total).toBe(1);
      expect(result.replayed).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          action: 'CREATE',
          entity: 'User',
          entityId: 'user-1',
          userId: 'admin-1',
          tenantSlug: 'acme',
          changes: { after: { name: 'John' } },
          metadata: { requestIp: '127.0.0.1' },
        },
      });
    });

    it('should strip failedAt from replayed entries', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['audit-fallback-2026-03-01.jsonl'] as any);
      mockFs.readFileSync.mockReturnValue(fallbackLine);
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'replayed-1' });

      await service.replayFallbackLogs();

      const createData = mockAuditLogCreate.mock.calls[0][0].data;
      expect(createData).not.toHaveProperty('failedAt');
    });

    it('should move file to replayed/ on full success', async () => {
      mockFs.existsSync
        .mockReturnValueOnce(true)   // FALLBACK_DIR exists
        .mockReturnValueOnce(true);  // REPLAYED_DIR exists
      mockFs.readdirSync.mockReturnValue(['audit-fallback-2026-03-01.jsonl'] as any);
      mockFs.readFileSync.mockReturnValue(fallbackLine);
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'replayed-1' });
      mockFs.renameSync.mockImplementation(() => undefined);

      await service.replayFallbackLogs();

      expect(mockFs.renameSync).toHaveBeenCalledWith(
        expect.stringContaining('audit-fallback-2026-03-01.jsonl'),
        expect.stringContaining(path.join('replayed', 'audit-fallback-2026-03-01.jsonl')),
      );
    });

    it('should create replayed/ directory if it does not exist', async () => {
      mockFs.existsSync
        .mockReturnValueOnce(true)    // FALLBACK_DIR exists
        .mockReturnValueOnce(false);  // REPLAYED_DIR does not exist
      mockFs.readdirSync.mockReturnValue(['audit-fallback-2026-03-01.jsonl'] as any);
      mockFs.readFileSync.mockReturnValue(fallbackLine);
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'replayed-1' });
      mockFs.renameSync.mockImplementation(() => undefined);

      await service.replayFallbackLogs();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('replayed'),
        { recursive: true },
      );
    });

    it('should rewrite file with failed entries on partial failure', async () => {
      const twoLines = [
        JSON.stringify({ ...fallbackEntry, entityId: 'user-1' }),
        JSON.stringify({ ...fallbackEntry, entityId: 'user-2' }),
      ].join('\n') + '\n';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['audit-fallback-2026-03-01.jsonl'] as any);
      mockFs.readFileSync.mockReturnValue(twoLines);
      mockAuditLogCreate
        .mockResolvedValueOnce({ id: 'replayed-1' })
        .mockRejectedValueOnce(new Error('db error'));

      const result = await service.replayFallbackLogs();

      expect(result.total).toBe(2);
      expect(result.replayed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].line).toBe(2);
      expect(result.errors[0].error).toBe('db error');

      // Should rewrite with only the failed line
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('audit-fallback-2026-03-01.jsonl'),
        expect.stringContaining('user-2'),
        'utf-8',
      );
    });

    it('should filter by date when option is provided', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'audit-fallback-2026-02-28.jsonl',
        'audit-fallback-2026-03-01.jsonl',
      ] as any);
      mockFs.readFileSync.mockReturnValue(fallbackLine);
      mockAuditLogCreate.mockResolvedValue({ id: 'replayed' });
      mockFs.renameSync.mockImplementation(() => undefined);

      await service.replayFallbackLogs({ date: '2026-03-01' });

      // Should only read the matching file
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('2026-03-01'),
        'utf-8',
      );
    });

    it('should not insert into DB during dry run', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['audit-fallback-2026-03-01.jsonl'] as any);
      mockFs.readFileSync.mockReturnValue(fallbackLine);

      const result = await service.replayFallbackLogs({ dryRun: true });

      expect(result.total).toBe(1);
      expect(result.replayed).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
      // Should not move or rewrite files in dry run
      expect(mockFs.renameSync).not.toHaveBeenCalled();
    });

    it('should use main prisma client for entries without tenantSlug', async () => {
      const noTenantEntry = { ...fallbackEntry, tenantSlug: undefined };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['audit-fallback-2026-03-01.jsonl'] as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(noTenantEntry) + '\n');
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'replayed-1' });
      mockFs.renameSync.mockImplementation(() => undefined);

      await service.replayFallbackLogs();

      expect(mockPrisma.getTenantClient).not.toHaveBeenCalled();
      expect(mockAuditLogCreate).toHaveBeenCalled();
    });

    it('should process files in chronological order', async () => {
      const readOrder: string[] = [];
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'audit-fallback-2026-03-02.jsonl',
        'audit-fallback-2026-03-01.jsonl',
      ] as any);
      mockFs.readFileSync.mockImplementation((filePath: any) => {
        readOrder.push(path.basename(filePath as string));
        return fallbackLine;
      });
      mockAuditLogCreate.mockResolvedValue({ id: 'replayed' });
      mockFs.renameSync.mockImplementation(() => undefined);

      await service.replayFallbackLogs();

      expect(readOrder).toEqual([
        'audit-fallback-2026-03-01.jsonl',
        'audit-fallback-2026-03-02.jsonl',
      ]);
    });
  });

  // ─── Hash chaining in log() ──────────────────────────

  describe('hash chaining', () => {
    it('should chain hashes by fetching previousHash from the last entry', async () => {
      mockAuditLogFindFirst.mockResolvedValueOnce({ hash: 'prev-hash-abc' });
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'log-2' });

      await service.log(baseAuditData);

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousHash: 'prev-hash-abc',
          hash: expect.any(String),
        }),
      });
    });

    it('should use null previousHash when no previous entry exists', async () => {
      mockAuditLogFindFirst.mockResolvedValueOnce(null);
      mockAuditLogCreate.mockResolvedValueOnce({ id: 'log-1' });

      await service.log(baseAuditData);

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousHash: null,
        }),
      });
    });

    it('should produce a deterministic hash for same data', async () => {
      const hashes: string[] = [];
      mockAuditLogCreate.mockImplementation((args: { data: { hash: string } }) => {
        hashes.push(args.data.hash);
        return Promise.resolve({ id: 'log' });
      });

      // Call log twice — different timestamps mean different hashes
      await service.log(baseAuditData);
      await service.log(baseAuditData);

      // Hashes should exist and be 64-char hex
      expect(hashes).toHaveLength(2);
      for (const h of hashes) {
        expect(h).toMatch(/^[a-f0-9]{64}$/);
      }
    });
  });

  // ─── verifyIntegrity() ──────────────────────────────────

  describe('verifyIntegrity', () => {
    it('should return verified with zero count for empty logs', async () => {
      mockAuditLogFindMany.mockResolvedValueOnce([]);

      const result = await service.verifyIntegrity('acme');

      expect(result).toEqual({ verified: true, checkedCount: 0 });
    });

    it('should verify a valid single-entry chain', async () => {
      const timestamp = new Date('2026-03-01T10:00:00.000Z');
      const hash = computeAuditHash({
        action: 'CREATE',
        entity: 'User',
        entityId: 'user-1',
        userId: 'admin-1',
        tenantSlug: 'acme',
        changes: { after: { name: 'John' } },
        timestamp: timestamp.toISOString(),
        previousHash: null,
      });

      mockAuditLogFindMany.mockResolvedValueOnce([{
        id: 'log-1',
        action: 'CREATE',
        entity: 'User',
        entityId: 'user-1',
        userId: 'admin-1',
        tenantSlug: 'acme',
        changes: { after: { name: 'John' } },
        timestamp,
        previousHash: null,
        hash,
      }]);

      const result = await service.verifyIntegrity('acme');

      expect(result.verified).toBe(true);
      expect(result.checkedCount).toBe(1);
    });

    it('should verify a valid multi-entry chain', async () => {
      const ts1 = new Date('2026-03-01T10:00:00.000Z');
      const ts2 = new Date('2026-03-01T10:01:00.000Z');

      const hash1 = computeAuditHash({
        action: 'CREATE', entity: 'User', entityId: 'user-1',
        userId: 'admin-1', tenantSlug: 'acme',
        changes: { after: { name: 'John' } },
        timestamp: ts1.toISOString(), previousHash: null,
      });
      const hash2 = computeAuditHash({
        action: 'UPDATE', entity: 'User', entityId: 'user-1',
        userId: 'admin-1', tenantSlug: 'acme',
        changes: { before: { name: 'John' }, after: { name: 'Jane' } },
        timestamp: ts2.toISOString(), previousHash: hash1,
      });

      mockAuditLogFindMany.mockResolvedValueOnce([
        { id: 'log-1', action: 'CREATE', entity: 'User', entityId: 'user-1', userId: 'admin-1', tenantSlug: 'acme', changes: { after: { name: 'John' } }, timestamp: ts1, previousHash: null, hash: hash1 },
        { id: 'log-2', action: 'UPDATE', entity: 'User', entityId: 'user-1', userId: 'admin-1', tenantSlug: 'acme', changes: { before: { name: 'John' }, after: { name: 'Jane' } }, timestamp: ts2, previousHash: hash1, hash: hash2 },
      ]);

      const result = await service.verifyIntegrity('acme');

      expect(result.verified).toBe(true);
      expect(result.checkedCount).toBe(2);
      expect(result.firstEntry).toBe(ts1.toISOString());
      expect(result.lastEntry).toBe(ts2.toISOString());
    });

    it('should detect a tampered hash', async () => {
      const ts1 = new Date('2026-03-01T10:00:00.000Z');
      const correctHash = computeAuditHash({
        action: 'CREATE', entity: 'User', entityId: 'user-1',
        userId: 'admin-1', tenantSlug: 'acme',
        changes: null,
        timestamp: ts1.toISOString(), previousHash: null,
      });

      mockAuditLogFindMany.mockResolvedValueOnce([{
        id: 'log-1', action: 'CREATE', entity: 'User', entityId: 'user-1',
        userId: 'admin-1', tenantSlug: 'acme', changes: null,
        timestamp: ts1, previousHash: null, hash: 'tampered-hash',
      }]);

      const result = await service.verifyIntegrity('acme');

      expect(result.verified).toBe(false);
      expect(result.brokenAt).toBeDefined();
      expect(result.brokenAt!.id).toBe('log-1');
      expect(result.brokenAt!.expectedHash).toBe(correctHash);
      expect(result.brokenAt!.actualHash).toBe('tampered-hash');
    });

    it('should detect broken previousHash linkage', async () => {
      const ts1 = new Date('2026-03-01T10:00:00.000Z');
      const ts2 = new Date('2026-03-01T10:01:00.000Z');

      const hash1 = computeAuditHash({
        action: 'CREATE', entity: 'User', entityId: 'user-1',
        tenantSlug: 'acme',
        timestamp: ts1.toISOString(), previousHash: null,
      });

      // Entry 2 has wrong previousHash — simulating tampering
      const wrongPrevHash = 'wrong-previous-hash';
      const hash2 = computeAuditHash({
        action: 'UPDATE', entity: 'User', entityId: 'user-1',
        tenantSlug: 'acme',
        timestamp: ts2.toISOString(), previousHash: wrongPrevHash,
      });

      mockAuditLogFindMany.mockResolvedValueOnce([
        { id: 'log-1', action: 'CREATE', entity: 'User', entityId: 'user-1', userId: null, tenantSlug: 'acme', changes: null, timestamp: ts1, previousHash: null, hash: hash1 },
        { id: 'log-2', action: 'UPDATE', entity: 'User', entityId: 'user-1', userId: null, tenantSlug: 'acme', changes: null, timestamp: ts2, previousHash: wrongPrevHash, hash: hash2 },
      ]);

      const result = await service.verifyIntegrity('acme');

      expect(result.verified).toBe(false);
      expect(result.brokenAt!.id).toBe('log-2');
    });

    it('should handle chain resets (null previousHash after first entry)', async () => {
      const ts1 = new Date('2026-03-01T10:00:00.000Z');
      const ts2 = new Date('2026-03-01T11:00:00.000Z');

      const hash1 = computeAuditHash({
        action: 'CREATE', entity: 'User', entityId: 'user-1',
        tenantSlug: 'acme',
        timestamp: ts1.toISOString(), previousHash: null,
      });
      const hash2 = computeAuditHash({
        action: 'CREATE', entity: 'Role', entityId: 'role-1',
        tenantSlug: 'acme',
        timestamp: ts2.toISOString(), previousHash: null,
      });

      mockAuditLogFindMany.mockResolvedValueOnce([
        { id: 'log-1', action: 'CREATE', entity: 'User', entityId: 'user-1', userId: null, tenantSlug: 'acme', changes: null, timestamp: ts1, previousHash: null, hash: hash1 },
        { id: 'log-2', action: 'CREATE', entity: 'Role', entityId: 'role-1', userId: null, tenantSlug: 'acme', changes: null, timestamp: ts2, previousHash: null, hash: hash2 },
      ]);

      const result = await service.verifyIntegrity('acme');

      expect(result.verified).toBe(true);
      expect(result.checkedCount).toBe(2);
    });

    it('should skip pre-migration entries without hash', async () => {
      const ts1 = new Date('2026-03-01T10:00:00.000Z');
      const ts2 = new Date('2026-03-01T10:01:00.000Z');

      const hash2 = computeAuditHash({
        action: 'UPDATE', entity: 'User', entityId: 'user-1',
        tenantSlug: 'acme',
        timestamp: ts2.toISOString(), previousHash: null,
      });

      mockAuditLogFindMany.mockResolvedValueOnce([
        { id: 'log-1', action: 'CREATE', entity: 'User', entityId: 'user-1', userId: null, tenantSlug: 'acme', changes: null, timestamp: ts1, previousHash: null, hash: null },
        { id: 'log-2', action: 'UPDATE', entity: 'User', entityId: 'user-1', userId: null, tenantSlug: 'acme', changes: null, timestamp: ts2, previousHash: null, hash: hash2 },
      ]);

      const result = await service.verifyIntegrity('acme');

      expect(result.verified).toBe(true);
      expect(result.checkedCount).toBe(2);
    });

    it('should pass date filters to findMany', async () => {
      mockAuditLogFindMany.mockResolvedValueOnce([]);

      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-03-01');

      await service.verifyIntegrity('acme', { startDate, endDate });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantSlug: 'acme',
            timestamp: { gte: startDate, lte: endDate },
          },
        }),
      );
    });

    it('should order logs by timestamp ascending for chain verification', async () => {
      mockAuditLogFindMany.mockResolvedValueOnce([]);

      await service.verifyIntegrity('acme');

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { timestamp: 'asc' },
        }),
      );
    });
  });

  // ─── getFailureCount() ────────────────────────────────

  describe('getFailureCount', () => {
    it('should start at 0', () => {
      expect(service.getFailureCount()).toBe(0);
    });

    it('should track multiple failures', async () => {
      mockAuditLogCreate.mockRejectedValue(new Error('fail'));

      const log1 = service.log(baseAuditData);
      await jest.advanceTimersByTimeAsync(300);
      await log1;

      const log2 = service.log(baseAuditData);
      await jest.advanceTimersByTimeAsync(300);
      await log2;

      expect(service.getFailureCount()).toBe(2);
    });
  });
});
