import { AuditLogController } from './audit-log.controller';
import type { AuthenticatedRequest } from '@saas/backend';

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let mockAuditService: {
    query: jest.Mock;
    queryAll: jest.Mock;
    applyRetention: jest.Mock;
    replayFallbackLogs: jest.Mock;
    verifyIntegrity: jest.Mock;
  };
  let mockRetentionCron: {
    isRunning: jest.Mock;
  };
  let mockAuditConfigService: {
    getConfig: jest.Mock;
    saveConfig: jest.Mock;
    getEntityFilter: jest.Mock;
  };

  const mockReq = {
    tenant: { slug: 'acme' },
    user: { sub: 'admin-1', role: 'ADMIN' },
  } as unknown as AuthenticatedRequest;

  const mockQueryResult = {
    logs: [
      { id: 'log-1', action: 'CREATE', entity: 'User', entityId: 'u-1', timestamp: new Date() },
    ],
    pagination: { total: 1, page: 1, limit: 10, pages: 1 },
  };

  const defaultConfig = {
    sensitiveFields: { '*': [] },
    ignoredFields: { '*': [] },
    entityFilter: null,
    retentionPolicy: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditService = {
      query: jest.fn().mockResolvedValue(mockQueryResult),
      queryAll: jest.fn().mockResolvedValue(mockQueryResult.logs),
      applyRetention: jest.fn().mockResolvedValue(5),
      replayFallbackLogs: jest.fn().mockResolvedValue({ total: 0, replayed: 0, failed: 0, errors: [] }),
      verifyIntegrity: jest.fn().mockResolvedValue({ verified: true, checkedCount: 10, firstEntry: '2026-01-01T00:00:00.000Z', lastEntry: '2026-03-01T00:00:00.000Z' }),
    };
    mockRetentionCron = {
      isRunning: jest.fn().mockReturnValue(false),
    };
    mockAuditConfigService = {
      getConfig: jest.fn().mockResolvedValue(defaultConfig),
      saveConfig: jest.fn().mockResolvedValue(defaultConfig),
      getEntityFilter: jest.fn().mockReturnValue({ exclude: ['AuditLog'] }),
    };
    controller = new AuditLogController(mockAuditService as any, mockRetentionCron as any, mockAuditConfigService as any);
  });

  // ─── getTenantSlug (private, tested via endpoints) ────

  describe('tenant context', () => {
    it('should throw when tenant context is missing', async () => {
      const reqNoTenant = { tenant: {} } as unknown as AuthenticatedRequest;

      await expect(
        controller.getAuditLogs(reqNoTenant, {}),
      ).rejects.toThrow('Tenant context is required');
    });

    it('should throw when tenant is undefined', async () => {
      const reqNoTenant = {} as unknown as AuthenticatedRequest;

      await expect(
        controller.getAuditLogs(reqNoTenant, {}),
      ).rejects.toThrow();
    });
  });

  // ─── GET /plugins/audit-log ───────────────────────────

  describe('getAuditLogs', () => {
    it('should return audit logs with default parameters', async () => {
      const result = await controller.getAuditLogs(mockReq, {});

      expect(mockAuditService.query).toHaveBeenCalledWith('acme', {
        entity: undefined,
        entityId: undefined,
        userId: undefined,
        action: undefined,
        search: undefined,
        startDate: undefined,
        endDate: undefined,
        page: undefined,
        limit: undefined,
        sortBy: undefined,
        sortOrder: undefined,
      });
      expect(result).toEqual(mockQueryResult);
    });

    it('should pass all query parameters to the service', async () => {
      const query = {
        entity: 'User',
        entityId: 'user-123',
        userId: 'admin-1',
        action: 'CREATE' as const,
        search: 'admin',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-03-01T00:00:00Z',
        page: 2,
        limit: 25,
        sortBy: 'action',
        sortOrder: 'asc' as const,
      };

      await controller.getAuditLogs(mockReq, query);

      expect(mockAuditService.query).toHaveBeenCalledWith('acme', {
        entity: 'User',
        entityId: 'user-123',
        userId: 'admin-1',
        action: 'CREATE',
        search: 'admin',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-03-01T00:00:00Z'),
        page: 2,
        limit: 25,
        sortBy: 'action',
        sortOrder: 'asc',
      });
    });

    it('should convert string page/limit to integers', async () => {
      // Query params may arrive as strings from HTTP
      const query = { page: '3' as any, limit: '20' as any };

      await controller.getAuditLogs(mockReq, query);

      expect(mockAuditService.query).toHaveBeenCalledWith('acme',
        expect.objectContaining({ page: 3, limit: 20 }),
      );
    });

    it('should convert date strings to Date objects', async () => {
      const query = {
        startDate: '2026-01-15T00:00:00Z',
        endDate: '2026-02-15T23:59:59Z',
      };

      await controller.getAuditLogs(mockReq, query);

      expect(mockAuditService.query).toHaveBeenCalledWith('acme',
        expect.objectContaining({
          startDate: new Date('2026-01-15T00:00:00Z'),
          endDate: new Date('2026-02-15T23:59:59Z'),
        }),
      );
    });

    it('should not convert dates when not provided', async () => {
      await controller.getAuditLogs(mockReq, {});

      expect(mockAuditService.query).toHaveBeenCalledWith('acme',
        expect.objectContaining({
          startDate: undefined,
          endDate: undefined,
        }),
      );
    });
  });

  // ─── GET /plugins/audit-log/export ──────────────────

  describe('exportAuditLogs', () => {
    let mockRes: {
      setHeader: jest.Mock;
      send: jest.Mock;
    };

    const mockExportLogs = [
      {
        id: 'log-1',
        action: 'CREATE',
        entity: 'User',
        entityId: 'u-1',
        timestamp: new Date('2026-01-15T10:30:00Z'),
        user: { id: 'u-1', name: 'Admin', email: 'admin@test.com' },
        changes: { after: { name: 'John' } },
        metadata: { requestIp: '192.168.1.1', userAgent: 'Mozilla/5.0' },
      },
    ];

    beforeEach(() => {
      mockAuditService.queryAll.mockResolvedValue(mockExportLogs);
      mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      };
    });

    it('should export as JSON with correct headers', async () => {
      await controller.exportAuditLogs(mockReq, { format: 'json' }, mockRes as any);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(/^attachment; filename=audit-logs-.+\.json$/),
      );
      const sentData = JSON.parse(mockRes.send.mock.calls[0][0]);
      expect(sentData).toEqual(JSON.parse(JSON.stringify(mockExportLogs)));
    });

    it('should export as CSV with correct headers', async () => {
      await controller.exportAuditLogs(mockReq, { format: 'csv' }, mockRes as any);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(/^attachment; filename=audit-logs-.+\.csv$/),
      );
      const csv = mockRes.send.mock.calls[0][0] as string;
      expect(csv).toContain('Timestamp,User,Action,Entity,Entity ID,Changes,IP Address,User Agent');
      expect(csv).toContain('Admin');
      expect(csv).toContain('CREATE');
      expect(csv).toContain('User');
    });

    it('should pass filters to queryAll', async () => {
      const query = {
        format: 'json' as const,
        entity: 'User',
        action: 'DELETE' as const,
        startDate: '2026-01-01T00:00:00Z',
        sortBy: 'action',
        sortOrder: 'asc' as const,
      };

      await controller.exportAuditLogs(mockReq, query, mockRes as any);

      expect(mockAuditService.queryAll).toHaveBeenCalledWith('acme', {
        entity: 'User',
        entityId: undefined,
        userId: undefined,
        action: 'DELETE',
        search: undefined,
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: undefined,
        sortBy: 'action',
        sortOrder: 'asc',
      });
    });

    it('should handle CSV fields with commas and quotes', async () => {
      mockAuditService.queryAll.mockResolvedValue([{
        ...mockExportLogs[0],
        changes: { after: { name: 'John "Johnny" Doe, Jr.' } },
      }]);

      await controller.exportAuditLogs(mockReq, { format: 'csv' }, mockRes as any);

      const csv = mockRes.send.mock.calls[0][0] as string;
      // Commas and quotes in JSON changes should be properly escaped
      expect(csv).toContain('""');
    });

    it('should handle logs with null user as System', async () => {
      mockAuditService.queryAll.mockResolvedValue([{
        ...mockExportLogs[0],
        user: null,
      }]);

      await controller.exportAuditLogs(mockReq, { format: 'csv' }, mockRes as any);

      const csv = mockRes.send.mock.calls[0][0] as string;
      expect(csv).toContain('System');
    });
  });

  // ─── POST /plugins/audit-log/retention ────────────────

  describe('applyRetention', () => {
    it('should apply time-based retention and return result', async () => {
      const dto = {
        type: 'time' as const,
        beforeDate: '2026-01-01T00:00:00+00:00',
        backup: true,
      };

      const result = await controller.applyRetention(mockReq, dto);

      expect(mockAuditService.applyRetention).toHaveBeenCalledWith('acme', {
        type: 'time',
        beforeDate: new Date('2026-01-01T00:00:00+00:00'),
        keepCount: undefined,
        backup: true,
      });
      expect(result).toEqual({
        deleted: 5,
        message: 'Successfully deleted 5 audit log(s)',
      });
    });

    it('should apply count-based retention', async () => {
      mockAuditService.applyRetention.mockResolvedValue(20);

      const dto = {
        type: 'count' as const,
        keepCount: 1000,
        backup: false,
      };

      const result = await controller.applyRetention(mockReq, dto);

      expect(mockAuditService.applyRetention).toHaveBeenCalledWith('acme', {
        type: 'count',
        beforeDate: undefined,
        keepCount: 1000,
        backup: false,
      });
      expect(result).toEqual({
        deleted: 20,
        message: 'Successfully deleted 20 audit log(s)',
      });
    });

    it('should default backup to true when not specified', async () => {
      const dto = {
        type: 'time' as const,
        beforeDate: '2026-01-01T00:00:00+00:00',
      };

      await controller.applyRetention(mockReq, dto);

      expect(mockAuditService.applyRetention).toHaveBeenCalledWith('acme',
        expect.objectContaining({ backup: true }),
      );
    });

    it('should throw when time type is used without beforeDate', async () => {
      const dto = { type: 'time' as const };

      await expect(
        controller.applyRetention(mockReq, dto),
      ).rejects.toThrow('beforeDate is required when type is "time"');
    });

    it('should throw when count type is used without keepCount', async () => {
      const dto = { type: 'count' as const };

      await expect(
        controller.applyRetention(mockReq, dto),
      ).rejects.toThrow('keepCount is required when type is "count"');
    });

    it('should return 0 deleted message when nothing to delete', async () => {
      mockAuditService.applyRetention.mockResolvedValue(0);

      const dto = {
        type: 'count' as const,
        keepCount: 10000,
      };

      const result = await controller.applyRetention(mockReq, dto);

      expect(result).toEqual({
        deleted: 0,
        message: 'Successfully deleted 0 audit log(s)',
      });
    });

    it('should propagate service errors', async () => {
      mockAuditService.applyRetention.mockRejectedValue(new Error('Failed to apply retention policy'));

      const dto = {
        type: 'time' as const,
        beforeDate: '2026-01-01T00:00:00+00:00',
      };

      await expect(
        controller.applyRetention(mockReq, dto),
      ).rejects.toThrow('Failed to apply retention policy');
    });
  });

  // ─── POST /plugins/audit-log/replay ──────────────────

  describe('replayFallbackLogs', () => {
    it('should call service with empty options by default', async () => {
      const result = await controller.replayFallbackLogs({});

      expect(mockAuditService.replayFallbackLogs).toHaveBeenCalledWith({
        date: undefined,
        dryRun: undefined,
      });
      expect(result.message).toContain('Replayed 0 of 0');
    });

    it('should pass date and dryRun options to service', async () => {
      mockAuditService.replayFallbackLogs.mockResolvedValue({
        total: 5, replayed: 5, failed: 0, errors: [],
      });

      const result = await controller.replayFallbackLogs({
        date: '2026-03-01',
        dryRun: true,
      });

      expect(mockAuditService.replayFallbackLogs).toHaveBeenCalledWith({
        date: '2026-03-01',
        dryRun: true,
      });
      expect(result.message).toContain('Dry run');
      expect(result.total).toBe(5);
      expect(result.replayed).toBe(5);
    });

    it('should return correct message for actual replay', async () => {
      mockAuditService.replayFallbackLogs.mockResolvedValue({
        total: 10, replayed: 8, failed: 2, errors: [
          { line: 3, error: 'db error' },
          { line: 7, error: 'timeout' },
        ],
      });

      const result = await controller.replayFallbackLogs({});

      expect(result.message).toBe('Replayed 8 of 10 entries (2 failed)');
      expect(result.errors).toHaveLength(2);
    });

    it('should propagate service errors', async () => {
      mockAuditService.replayFallbackLogs.mockRejectedValue(new Error('Replay failed'));

      await expect(
        controller.replayFallbackLogs({}),
      ).rejects.toThrow('Replay failed');
    });
  });

  // ─── GET /plugins/audit-log/verify ──────────────────

  describe('verifyIntegrity', () => {
    it('should verify integrity with default parameters', async () => {
      const result = await controller.verifyIntegrity(mockReq, {});

      expect(mockAuditService.verifyIntegrity).toHaveBeenCalledWith('acme', {
        startDate: undefined,
        endDate: undefined,
      });
      expect(result).toEqual({
        verified: true,
        checkedCount: 10,
        firstEntry: '2026-01-01T00:00:00.000Z',
        lastEntry: '2026-03-01T00:00:00.000Z',
      });
    });

    it('should pass date filters to service', async () => {
      await controller.verifyIntegrity(mockReq, {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-03-01T00:00:00Z',
      });

      expect(mockAuditService.verifyIntegrity).toHaveBeenCalledWith('acme', {
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-03-01T00:00:00Z'),
      });
    });

    it('should return failure details when chain is broken', async () => {
      const failureResult = {
        verified: false,
        checkedCount: 5,
        firstEntry: '2026-01-01T00:00:00.000Z',
        lastEntry: '2026-01-05T00:00:00.000Z',
        brokenAt: {
          id: 'log-5',
          timestamp: '2026-01-05T00:00:00.000Z',
          expectedHash: 'abc123',
          actualHash: 'def456',
        },
      };
      mockAuditService.verifyIntegrity.mockResolvedValueOnce(failureResult);

      const result = await controller.verifyIntegrity(mockReq, {});

      expect(result.verified).toBe(false);
      expect(result.brokenAt).toBeDefined();
      expect(result.brokenAt.id).toBe('log-5');
    });

    it('should require tenant context', async () => {
      const reqNoTenant = { tenant: {} } as unknown as AuthenticatedRequest;

      await expect(
        controller.verifyIntegrity(reqNoTenant, {}),
      ).rejects.toThrow('Tenant context is required');
    });

    it('should propagate service errors', async () => {
      mockAuditService.verifyIntegrity.mockRejectedValueOnce(new Error('Database error'));

      await expect(
        controller.verifyIntegrity(mockReq, {}),
      ).rejects.toThrow('Database error');
    });
  });

  // ─── GET /plugins/audit-log/config ────────────────────

  describe('getAuditConfig', () => {
    it('should return config with isRetentionRunning', async () => {
      const result = await controller.getAuditConfig(mockReq);

      expect(mockAuditConfigService.getConfig).toHaveBeenCalledWith('acme');
      expect(mockRetentionCron.isRunning).toHaveBeenCalled();
      expect(result).toEqual({
        ...defaultConfig,
        isRetentionRunning: false,
      });
    });

    it('should reflect running retention status', async () => {
      mockRetentionCron.isRunning.mockReturnValue(true);

      const result = await controller.getAuditConfig(mockReq);

      expect(result.isRetentionRunning).toBe(true);
    });
  });

  // ─── PUT /plugins/audit-log/config ────────────────────

  describe('updateAuditConfig', () => {
    it('should save config and return result with message', async () => {
      const dto = { sensitiveFields: { '*': ['password'] } };

      const result = await controller.updateAuditConfig(mockReq, dto);

      expect(mockAuditConfigService.saveConfig).toHaveBeenCalledWith('acme', dto);
      expect(result.message).toBe('Audit configuration updated successfully');
    });
  });
});
