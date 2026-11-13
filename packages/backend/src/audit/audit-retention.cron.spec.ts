import { AuditRetentionCron } from './audit-retention.cron';
import { AuditRetentionPolicy } from './audit.config';

const mockTenantFindMany = jest.fn();
const mockPrisma = {
  tenant: {
    findMany: mockTenantFindMany,
  },
};

const mockApplyRetention = jest.fn();
const mockAuditService = {
  applyRetention: mockApplyRetention,
};

const mockGetConfig = jest.fn();
const mockAuditConfigService = {
  getConfig: mockGetConfig,
};

describe('AuditRetentionCron', () => {
  let cron: AuditRetentionCron;

  const enabledTimePolicy: AuditRetentionPolicy = {
    enabled: true,
    type: 'time',
    retainDays: 90,
    backup: true,
  };

  const enabledCountPolicy: AuditRetentionPolicy = {
    enabled: true,
    type: 'count',
    keepCount: 10000,
    backup: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cron = new AuditRetentionCron(
      mockPrisma as any,
      mockAuditService as any,
      mockAuditConfigService as any,
    );
    // Default: return config with no retention policy (disabled by default)
    mockGetConfig.mockResolvedValue({
      sensitiveFields: {},
      ignoredFields: {},
      entityFilter: null,
      retentionPolicy: null,
    });
  });

  // ─── handleRetention ───────────────────────────────────

  describe('handleRetention', () => {
    it('should skip all tenants when retention policy is null (default disabled)', async () => {
      mockTenantFindMany.mockResolvedValue([
        { slug: 'acme' },
        { slug: 'beta' },
      ]);

      const results = await cron.handleRetention();

      expect(results).toEqual([]);
      expect(mockApplyRetention).not.toHaveBeenCalled();
      expect(mockGetConfig).toHaveBeenCalledTimes(2);
    });

    it('should skip tenants with disabled retention policy', async () => {
      mockTenantFindMany.mockResolvedValue([{ slug: 'acme' }]);
      mockGetConfig.mockResolvedValue({
        sensitiveFields: {},
        ignoredFields: {},
        entityFilter: null,
        retentionPolicy: { enabled: false, type: 'time', retainDays: 90, backup: true },
      });

      const results = await cron.handleRetention();

      expect(results).toEqual([]);
      expect(mockApplyRetention).not.toHaveBeenCalled();
    });

    it('should apply time-based retention for tenants with enabled policy', async () => {
      mockTenantFindMany.mockResolvedValue([
        { slug: 'acme' },
        { slug: 'beta' },
      ]);
      mockGetConfig.mockResolvedValue({
        sensitiveFields: {},
        ignoredFields: {},
        entityFilter: null,
        retentionPolicy: enabledTimePolicy,
      });
      mockApplyRetention.mockResolvedValue(10);

      const results = await cron.handleRetention();

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ tenantSlug: 'acme', deleted: 10 });
      expect(results[1]).toEqual({ tenantSlug: 'beta', deleted: 10 });

      expect(mockApplyRetention).toHaveBeenCalledTimes(2);
      expect(mockApplyRetention).toHaveBeenCalledWith('acme', {
        type: 'time',
        beforeDate: expect.any(Date),
        backup: true,
      });
    });

    it('should calculate beforeDate based on retainDays', async () => {
      mockTenantFindMany.mockResolvedValue([{ slug: 'acme' }]);
      mockGetConfig.mockResolvedValue({
        sensitiveFields: {},
        ignoredFields: {},
        entityFilter: null,
        retentionPolicy: { ...enabledTimePolicy, retainDays: 30 },
      });
      mockApplyRetention.mockResolvedValue(0);

      const before = Date.now();
      await cron.handleRetention();
      const after = Date.now();

      const calledDate: Date = mockApplyRetention.mock.calls[0][1].beforeDate;
      const expectedMs = 30 * 24 * 60 * 60 * 1000;

      // beforeDate should be ~30 days ago (within test execution window)
      expect(before - calledDate.getTime()).toBeGreaterThanOrEqual(expectedMs - 1000);
      expect(after - calledDate.getTime()).toBeLessThanOrEqual(expectedMs + 1000);
    });

    it('should apply count-based retention', async () => {
      mockTenantFindMany.mockResolvedValue([{ slug: 'acme' }]);
      mockGetConfig.mockResolvedValue({
        sensitiveFields: {},
        ignoredFields: {},
        entityFilter: null,
        retentionPolicy: enabledCountPolicy,
      });
      mockApplyRetention.mockResolvedValue(500);

      const results = await cron.handleRetention();

      expect(results).toEqual([{ tenantSlug: 'acme', deleted: 500 }]);
      expect(mockApplyRetention).toHaveBeenCalledWith('acme', {
        type: 'count',
        keepCount: 10000,
        backup: false,
      });
    });

    it('should query only active tenants', async () => {
      mockTenantFindMany.mockResolvedValue([]);
      mockApplyRetention.mockResolvedValue(0);

      await cron.handleRetention();

      expect(mockTenantFindMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
        select: { slug: true },
      });
    });

    it('should support per-tenant policies', async () => {
      mockTenantFindMany.mockResolvedValue([
        { slug: 'acme' },
        { slug: 'beta' },
      ]);
      // acme has time-based, beta has count-based
      mockGetConfig
        .mockResolvedValueOnce({
          sensitiveFields: {},
          ignoredFields: {},
          entityFilter: null,
          retentionPolicy: enabledTimePolicy,
        })
        .mockResolvedValueOnce({
          sensitiveFields: {},
          ignoredFields: {},
          entityFilter: null,
          retentionPolicy: enabledCountPolicy,
        });
      mockApplyRetention.mockResolvedValue(5);

      const results = await cron.handleRetention();

      expect(results).toHaveLength(2);
      expect(mockApplyRetention).toHaveBeenCalledWith('acme', {
        type: 'time',
        beforeDate: expect.any(Date),
        backup: true,
      });
      expect(mockApplyRetention).toHaveBeenCalledWith('beta', {
        type: 'count',
        keepCount: 10000,
        backup: false,
      });
    });

    it('should continue processing other tenants when one fails', async () => {
      mockTenantFindMany.mockResolvedValue([
        { slug: 'acme' },
        { slug: 'beta' },
        { slug: 'gamma' },
      ]);
      mockGetConfig.mockResolvedValue({
        sensitiveFields: {},
        ignoredFields: {},
        entityFilter: null,
        retentionPolicy: enabledTimePolicy,
      });
      mockApplyRetention
        .mockResolvedValueOnce(5)
        .mockRejectedValueOnce(new Error('db connection lost'))
        .mockResolvedValueOnce(3);

      const results = await cron.handleRetention();

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ tenantSlug: 'acme', deleted: 5 });
      expect(results[1]).toEqual({
        tenantSlug: 'beta',
        deleted: 0,
        error: 'db connection lost',
      });
      expect(results[2]).toEqual({ tenantSlug: 'gamma', deleted: 3 });
    });

    it('should return empty when no tenants exist', async () => {
      mockTenantFindMany.mockResolvedValue([]);

      const results = await cron.handleRetention();

      expect(results).toEqual([]);
      expect(mockApplyRetention).not.toHaveBeenCalled();
    });
  });

  // ─── Lock mechanism ────────────────────────────────────

  describe('lock mechanism', () => {
    it('should report not running initially', () => {
      expect(cron.isRunning()).toBe(false);
    });

    it('should prevent concurrent runs', async () => {
      mockTenantFindMany.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([{ slug: 'acme' }]), 50)),
      );
      mockGetConfig.mockResolvedValue({
        sensitiveFields: {},
        ignoredFields: {},
        entityFilter: null,
        retentionPolicy: enabledTimePolicy,
      });
      mockApplyRetention.mockResolvedValue(0);

      // Start first run
      const run1 = cron.handleRetention();

      // Second run should be skipped
      const run2 = cron.handleRetention();

      const [results1, results2] = await Promise.all([run1, run2]);

      // The second run should have returned empty (skipped)
      expect(results2).toEqual([]);
    });

    it('should release lock after completion', async () => {
      mockTenantFindMany.mockResolvedValue([{ slug: 'acme' }]);
      mockGetConfig.mockResolvedValue({
        sensitiveFields: {},
        ignoredFields: {},
        entityFilter: null,
        retentionPolicy: enabledTimePolicy,
      });
      mockApplyRetention.mockResolvedValue(0);

      await cron.handleRetention();
      expect(cron.isRunning()).toBe(false);
    });

    it('should release lock even on error', async () => {
      mockTenantFindMany.mockRejectedValue(new Error('db down'));

      await expect(cron.handleRetention()).rejects.toThrow('db down');
      expect(cron.isRunning()).toBe(false);
    });
  });
});
