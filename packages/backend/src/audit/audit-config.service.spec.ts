import { AuditConfigService } from './audit-config.service';
import { AUDIT_SENSITIVE_FIELDS, AUDIT_IGNORED_FIELDS, DEFAULT_AUDIT_FILTER, DEFAULT_RETENTION_POLICY } from './audit.config';

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

describe('AuditConfigService', () => {
  let service: AuditConfigService;
  let mockPrisma: any;
  let mockCache: ReturnType<typeof createMockCache>;
  let mockTenantClient: any;

  beforeEach(() => {
    mockTenantClient = {
      auditConfig: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    mockPrisma = {
      getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
    };

    mockCache = createMockCache();

    service = new AuditConfigService(mockPrisma as any, mockCache as any);
  });

  describe('getConfig', () => {
    it('should return defaults when no DB record exists', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue(null);

      const config = await service.getConfig('acme');

      expect(config.sensitiveFields).toEqual(AUDIT_SENSITIVE_FIELDS);
      expect(config.ignoredFields).toEqual(AUDIT_IGNORED_FIELDS);
    });

    it('should return DB values when record exists', async () => {
      const dbRecord = {
        id: 'cfg-1',
        sensitiveFields: { '*': ['password', 'token'] },
        ignoredFields: { '*': ['updatedAt'] },
      };
      mockTenantClient.auditConfig.findFirst.mockResolvedValue(dbRecord);

      const config = await service.getConfig('acme');

      expect(config.sensitiveFields).toEqual({ '*': ['password', 'token'] });
      expect(config.ignoredFields).toEqual({ '*': ['updatedAt'] });
    });

    it('should cache results and not re-query within TTL', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue(null);

      await service.getConfig('acme');
      await service.getConfig('acme');

      expect(mockTenantClient.auditConfig.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should return defaults on DB error', async () => {
      mockTenantClient.auditConfig.findFirst.mockRejectedValue(new Error('DB down'));

      const config = await service.getConfig('acme');

      expect(config.sensitiveFields).toEqual(AUDIT_SENSITIVE_FIELDS);
      expect(config.ignoredFields).toEqual(AUDIT_IGNORED_FIELDS);
    });
  });

  describe('saveConfig', () => {
    it('should create a new record when none exists', async () => {
      mockTenantClient.auditConfig.findFirst
        .mockResolvedValueOnce(null) // first call in saveConfig
        .mockResolvedValueOnce({     // second call in getConfig after save
          id: 'cfg-new',
          sensitiveFields: { '*': ['password'] },
          ignoredFields: { '*': ['createdAt'] },
        });
      mockTenantClient.auditConfig.create.mockResolvedValue({});

      const result = await service.saveConfig('acme', {
        sensitiveFields: { '*': ['password'] },
        ignoredFields: { '*': ['createdAt'] },
      });

      expect(mockTenantClient.auditConfig.create).toHaveBeenCalled();
      expect(result.sensitiveFields).toEqual({ '*': ['password'] });
    });

    it('should update existing record', async () => {
      mockTenantClient.auditConfig.findFirst
        .mockResolvedValueOnce({ id: 'cfg-1' }) // first call in saveConfig
        .mockResolvedValueOnce({                  // second call in getConfig after save
          id: 'cfg-1',
          sensitiveFields: { '*': ['password', 'secret'] },
          ignoredFields: { '*': ['updatedAt'] },
        });
      mockTenantClient.auditConfig.update.mockResolvedValue({});

      const result = await service.saveConfig('acme', {
        sensitiveFields: { '*': ['password', 'secret'] },
      });

      expect(mockTenantClient.auditConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { sensitiveFields: { '*': ['password', 'secret'] } },
      });
      expect(result.sensitiveFields).toEqual({ '*': ['password', 'secret'] });
    });

    it('should invalidate cache after save', async () => {
      // Populate cache
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': ['old'] },
        ignoredFields: { '*': [] },
      });
      await service.getConfig('acme');
      expect(mockTenantClient.auditConfig.findFirst).toHaveBeenCalledTimes(1);

      // Save should invalidate + refetch
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': ['new'] },
        ignoredFields: { '*': [] },
      });
      mockTenantClient.auditConfig.update.mockResolvedValue({});

      await service.saveConfig('acme', { sensitiveFields: { '*': ['new'] } });

      // Should have re-fetched from DB
      expect(mockTenantClient.auditConfig.findFirst).toHaveBeenCalledTimes(3); // 1 initial + 1 in save + 1 in getConfig
    });
  });

  describe('getSensitiveFields (sync)', () => {
    it('should return defaults when no cache', () => {
      const result = service.getSensitiveFields('acme');
      expect(result).toEqual(AUDIT_SENSITIVE_FIELDS);
    });

    it('should return cached config after getConfig', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': ['password'], User: ['ssn'] },
        ignoredFields: { '*': [] },
      });

      await service.getConfig('acme');
      const result = service.getSensitiveFields('acme');

      expect(result).toEqual({ '*': ['password'], User: ['ssn'] });
    });

    it('should return defaults when tenantSlug is undefined', () => {
      const result = service.getSensitiveFields(undefined);
      expect(result).toEqual(AUDIT_SENSITIVE_FIELDS);
    });
  });

  describe('getIgnoredFields (sync)', () => {
    it('should return defaults when no cache', () => {
      const result = service.getIgnoredFields('acme');
      expect(result).toEqual(AUDIT_IGNORED_FIELDS);
    });

    it('should return cached config after getConfig', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': [] },
        ignoredFields: { '*': ['createdAt'], User: ['lastLoginAt'] },
      });

      await service.getConfig('acme');
      const result = service.getIgnoredFields('acme');

      expect(result).toEqual({ '*': ['createdAt'], User: ['lastLoginAt'] });
    });

    it('should return defaults when tenantSlug is undefined', () => {
      const result = service.getIgnoredFields(undefined);
      expect(result).toEqual(AUDIT_IGNORED_FIELDS);
    });
  });

  describe('per-tenant isolation', () => {
    it('should cache separately for different tenants', async () => {
      mockTenantClient.auditConfig.findFirst
        .mockResolvedValueOnce({
          id: 'cfg-1',
          sensitiveFields: { '*': ['password'] },
          ignoredFields: { '*': ['createdAt'] },
        })
        .mockResolvedValueOnce({
          id: 'cfg-2',
          sensitiveFields: { '*': ['token'] },
          ignoredFields: { '*': ['updatedAt'] },
        });

      await service.getConfig('acme');
      await service.getConfig('beta');

      expect(service.getSensitiveFields('acme')).toEqual({ '*': ['password'] });
      expect(service.getSensitiveFields('beta')).toEqual({ '*': ['token'] });
    });
  });

  describe('getEntityFilter (sync)', () => {
    it('should return DEFAULT_AUDIT_FILTER when tenantSlug is undefined', () => {
      const result = service.getEntityFilter(undefined);
      expect(result).toEqual(DEFAULT_AUDIT_FILTER);
    });

    it('should return DEFAULT_AUDIT_FILTER when no cache exists', () => {
      const result = service.getEntityFilter('acme');
      expect(result).toEqual(DEFAULT_AUDIT_FILTER);
    });

    it('should return DEFAULT_AUDIT_FILTER when cached entityFilter is null', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': ['password'] },
        ignoredFields: { '*': ['createdAt'] },
        entityFilter: null,
      });

      await service.getConfig('acme');
      const result = service.getEntityFilter('acme');

      expect(result).toEqual(DEFAULT_AUDIT_FILTER);
    });

    it('should return converted config when cached entityFilter exists (exclude mode)', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': [] },
        ignoredFields: { '*': [] },
        entityFilter: { mode: 'exclude', entities: ['Session', 'TempCache'] },
      });

      await service.getConfig('acme');
      const result = service.getEntityFilter('acme');

      expect(result.exclude).toContain('AuditLog');
      expect(result.exclude).toContain('Session');
      expect(result.exclude).toContain('TempCache');
      expect(result.include).toBeUndefined();
    });

    it('should return converted config when cached entityFilter exists (include mode)', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': [] },
        ignoredFields: { '*': [] },
        entityFilter: { mode: 'include', entities: ['User', 'Role'] },
      });

      await service.getConfig('acme');
      const result = service.getEntityFilter('acme');

      expect(result.include).toEqual(['User', 'Role']);
      expect(result.exclude).toBeUndefined();
    });

    it('should return converted config with actions', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': [] },
        ignoredFields: { '*': [] },
        entityFilter: {
          mode: 'exclude',
          entities: [],
          actions: { User: ['CREATE', 'DELETE'] },
        },
      });

      await service.getConfig('acme');
      const result = service.getEntityFilter('acme');

      expect(result.actions).toEqual({ User: ['CREATE', 'DELETE'] });
    });
  });

  describe('saveConfig with entityFilter', () => {
    it('should persist entityFilter when provided', async () => {
      mockTenantClient.auditConfig.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'cfg-new',
          sensitiveFields: { '*': [] },
          ignoredFields: { '*': [] },
          entityFilter: { mode: 'exclude', entities: ['Session'] },
        });
      mockTenantClient.auditConfig.create.mockResolvedValue({});

      const result = await service.saveConfig('acme', {
        entityFilter: { mode: 'exclude', entities: ['Session'] },
      });

      expect(mockTenantClient.auditConfig.create).toHaveBeenCalledWith({
        data: { entityFilter: { mode: 'exclude', entities: ['Session'] } },
      });
      expect(result.entityFilter).toEqual({ mode: 'exclude', entities: ['Session'] });
    });

    it('should persist null entityFilter to reset to default', async () => {
      mockTenantClient.auditConfig.findFirst
        .mockResolvedValueOnce({ id: 'cfg-1' })
        .mockResolvedValueOnce({
          id: 'cfg-1',
          sensitiveFields: { '*': [] },
          ignoredFields: { '*': [] },
          entityFilter: null,
        });
      mockTenantClient.auditConfig.update.mockResolvedValue({});

      const result = await service.saveConfig('acme', {
        entityFilter: null,
      });

      expect(mockTenantClient.auditConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { entityFilter: null },
      });
      expect(result.entityFilter).toBeNull();
    });
  });

  describe('getRetentionPolicy (sync)', () => {
    it('should return DEFAULT_RETENTION_POLICY when tenantSlug is undefined', () => {
      const result = service.getRetentionPolicy(undefined);
      expect(result).toEqual(DEFAULT_RETENTION_POLICY);
    });

    it('should return DEFAULT_RETENTION_POLICY when no cache exists', () => {
      const result = service.getRetentionPolicy('acme');
      expect(result).toEqual(DEFAULT_RETENTION_POLICY);
    });

    it('should return DEFAULT_RETENTION_POLICY when cached retentionPolicy is null', async () => {
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': [] },
        ignoredFields: { '*': [] },
        entityFilter: null,
        retentionPolicy: null,
      });

      await service.getConfig('acme');
      const result = service.getRetentionPolicy('acme');

      expect(result).toEqual(DEFAULT_RETENTION_POLICY);
    });

    it('should return cached retentionPolicy when configured', async () => {
      const policy = { enabled: true, type: 'time' as const, retainDays: 30, backup: true };
      mockTenantClient.auditConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        sensitiveFields: { '*': [] },
        ignoredFields: { '*': [] },
        entityFilter: null,
        retentionPolicy: policy,
      });

      await service.getConfig('acme');
      const result = service.getRetentionPolicy('acme');

      expect(result).toEqual(policy);
    });
  });

  describe('saveConfig with retentionPolicy', () => {
    it('should persist retentionPolicy when provided', async () => {
      const policy = { enabled: true, type: 'time' as const, retainDays: 60, backup: false };
      mockTenantClient.auditConfig.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'cfg-new',
          sensitiveFields: { '*': [] },
          ignoredFields: { '*': [] },
          entityFilter: null,
          retentionPolicy: policy,
        });
      mockTenantClient.auditConfig.create.mockResolvedValue({});

      const result = await service.saveConfig('acme', {
        retentionPolicy: policy,
      });

      expect(mockTenantClient.auditConfig.create).toHaveBeenCalledWith({
        data: { retentionPolicy: policy },
      });
      expect(result.retentionPolicy).toEqual(policy);
    });

    it('should persist null retentionPolicy to reset to default', async () => {
      mockTenantClient.auditConfig.findFirst
        .mockResolvedValueOnce({ id: 'cfg-1' })
        .mockResolvedValueOnce({
          id: 'cfg-1',
          sensitiveFields: { '*': [] },
          ignoredFields: { '*': [] },
          entityFilter: null,
          retentionPolicy: null,
        });
      mockTenantClient.auditConfig.update.mockResolvedValue({});

      const result = await service.saveConfig('acme', {
        retentionPolicy: null,
      });

      expect(mockTenantClient.auditConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { retentionPolicy: null },
      });
      expect(result.retentionPolicy).toBeNull();
    });
  });
});
