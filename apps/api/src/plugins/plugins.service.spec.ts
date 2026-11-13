import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PluginsService } from './plugins.service';

// Mutable lifecycle/config/manifests/permissions maps so tests can inject hooks and manifests
const mockPluginLifecycles: Record<string, any> = {};
const mockPluginConfigSchemas: Record<string, any> = {};
const mockPluginManifests: Record<string, any> = {};
const mockPluginPermissions: Record<string, any[]> = {};

// Mock the plugin registry
jest.mock('../plugin-registry', () => ({
  PluginList: [
    {
      key: 'sample-plugin',
      name: 'Sample Plugin',
      description: 'A sample plugin',
      version: '1.0.0',
      authorName: 'Test',
      authorEmail: 'test@test.com',
      authorUrl: null,
      dependencies: [],
      conflicts: [],
    },
    {
      key: 'audit-log',
      name: 'Audit Log',
      description: 'Audit logging plugin',
      version: '1.0.0',
      authorName: 'Test',
      authorEmail: 'test@test.com',
      authorUrl: null,
      dependencies: [],
      conflicts: [],
    },
  ],
  get PluginLifecycles() { return mockPluginLifecycles; },
  get PluginConfigSchemas() { return mockPluginConfigSchemas; },
  get PluginManifests() { return mockPluginManifests; },
  get PluginPermissions() { return mockPluginPermissions; },
}));

describe('PluginsService', () => {
  let service: PluginsService;

  const mockTenantClient = {
    plugin: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    tenantSubscription: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    permission: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    role: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
  };

  const mockPrismaService = {
    plugin: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    app: { findMany: jest.fn().mockResolvedValue([]) },
    appPlugin: { findMany: jest.fn().mockResolvedValue([]) },
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  const mockCacheService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    delPattern: jest.fn().mockResolvedValue(undefined),
  };

  const mockPluginEventService = {
    emit: jest.fn(),
    emitAsync: jest.fn().mockResolvedValue(undefined),
  };

  const mockMetricsService = {
    record: jest.fn(),
    getAll: jest.fn().mockReturnValue({}),
    getForPlugin: jest.fn(),
    reset: jest.fn(),
  };

  const mockLockService = {
    withLock: jest.fn((key: string, fn: () => Promise<any>) => fn()),
  };

  const systemPlugin = {
    key: 'sample-plugin',
    name: 'Sample Plugin',
    description: 'A sample plugin',
    version: '1.0.0',
    isEnabled: true,
    authorName: 'Test',
    authorEmail: 'test@test.com',
    authorUrl: null,
    pricingModel: 'FREE',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear mutable lifecycle/config/manifests/permissions maps
    for (const key of Object.keys(mockPluginLifecycles)) delete mockPluginLifecycles[key];
    for (const key of Object.keys(mockPluginConfigSchemas)) delete mockPluginConfigSchemas[key];
    for (const key of Object.keys(mockPluginManifests)) delete mockPluginManifests[key];
    for (const key of Object.keys(mockPluginPermissions)) delete mockPluginPermissions[key];
    // Reset implementations that individual tests override
    mockTenantClient.tenantSubscription.findUnique.mockResolvedValue(null);
    mockTenantClient.tenantSubscription.findMany.mockResolvedValue([]);
    mockTenantClient.permission.findMany.mockResolvedValue([]);
    mockTenantClient.role.findFirst.mockResolvedValue(null);

    service = new PluginsService(mockPrismaService as any, mockCacheService as any, mockPluginEventService as any, mockMetricsService as any, mockLockService as any);
  });

  describe('syncPlugins', () => {
    it('should upsert all plugins from registry', async () => {
      mockPrismaService.plugin.upsert.mockResolvedValue({});

      await service.syncPlugins();

      expect(mockPrismaService.plugin.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.plugin.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'sample-plugin' },
          create: expect.objectContaining({
            key: 'sample-plugin',
            isEnabled: false,
          }),
        }),
      );
    });
  });

  describe('findAllSystem', () => {
    it('should return all plugins ordered by name', async () => {
      const plugins = [
        { key: 'audit-log', name: 'Audit Log', isEnabled: true },
        { key: 'sample-plugin', name: 'Sample Plugin', isEnabled: false },
      ];
      mockPrismaService.plugin.findMany.mockResolvedValue(plugins);

      const result = await service.findAllSystem();

      expect(result).toEqual(plugins);
      expect(mockPrismaService.plugin.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('toggleSystem', () => {
    it('should enable a plugin at system level', async () => {
      mockPrismaService.plugin.upsert.mockResolvedValue({ key: 'sample-plugin', isEnabled: true });

      const result = await service.toggleSystem('sample-plugin', true);

      expect(result.isEnabled).toBe(true);
      expect(mockPrismaService.plugin.upsert).toHaveBeenCalledWith({
        where: { key: 'sample-plugin' },
        update: { isEnabled: true },
        create: { key: 'sample-plugin', name: 'sample-plugin', isEnabled: true },
      });
    });
  });

  describe('findAllTenant', () => {
    it('should merge system plugins with tenant state', async () => {
      const systemPlugins = [
        { key: 'audit-log', name: 'Audit Log', isEnabled: true },
        { key: 'sample-plugin', name: 'Sample Plugin', isEnabled: true },
      ];
      const tenantPlugins = [
        { key: 'audit-log', isEnabled: true },
      ];

      mockPrismaService.plugin.findMany.mockResolvedValue(systemPlugins);
      mockTenantClient.plugin.findMany.mockResolvedValue(tenantPlugins);

      const result = await service.findAllTenant('acme');

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('audit-log');
      expect(result[0].isEnabled).toBe(true);
      expect(result[1].key).toBe('sample-plugin');
      expect(result[1].isEnabled).toBe(false); // Not enabled in tenant
    });

    it('says which live apps include a plugin', async () => {
      mockPrismaService.plugin.findMany.mockResolvedValue([{ key: 'inventory', name: 'Inventory', isEnabled: true }, { key: 'docs', name: 'Docs', isEnabled: true }]);
      mockTenantClient.plugin.findMany.mockResolvedValue([]);
      mockTenantClient.tenantSubscription.findMany.mockResolvedValue([
        { pluginKey: 'app:warehouse', status: 'ACTIVE', trialEndsAt: null, grantedPlugins: ['inventory'] },
        { pluginKey: 'app:retail', status: 'PAUSED', trialEndsAt: null, grantedPlugins: ['inventory'] },
      ]);
      mockPrismaService.app.findMany.mockResolvedValue([{ id: 'a1', key: 'warehouse', name: 'Warehouse' }, { id: 'a2', key: 'retail', name: 'Retail' }]);
      mockPrismaService.appPlugin.findMany.mockResolvedValue([{ appId: 'a1', pluginKey: 'inventory' }, { appId: 'a2', pluginKey: 'inventory' }]);

      const result = await service.findAllTenant('acme');

      expect(result.find((p) => p.key === 'inventory')?.includedIn).toEqual([{ key: 'warehouse', name: 'Warehouse' }]);
      expect(result.find((p) => p.key === 'docs')?.includedIn).toEqual([]);
    });

    it('a plugin taken out of a live app is no longer shown as included', async () => {
      mockPrismaService.plugin.findMany.mockResolvedValue([{ key: 'inventory', name: 'Inventory', isEnabled: true }]);
      mockTenantClient.plugin.findMany.mockResolvedValue([]);
      mockTenantClient.tenantSubscription.findMany.mockResolvedValue([
        { pluginKey: 'app:warehouse', status: 'ACTIVE', trialEndsAt: null, grantedPlugins: ['inventory'] },
      ]);
      mockPrismaService.app.findMany.mockResolvedValue([{ id: 'a1', key: 'warehouse', name: 'Warehouse' }]);
      mockPrismaService.appPlugin.findMany.mockResolvedValue([]);

      const result = await service.findAllTenant('acme');

      expect(result[0].includedIn).toEqual([]);
    });

    it('should only include globally enabled plugins', async () => {
      mockPrismaService.plugin.findMany.mockResolvedValue([]);
      mockTenantClient.plugin.findMany.mockResolvedValue([]);

      const result = await service.findAllTenant('acme');

      expect(result).toHaveLength(0);
      expect(mockPrismaService.plugin.findMany).toHaveBeenCalledWith({
        where: { isEnabled: true },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('findEnabledForTenant', () => {
    it('should return only keys of plugins enabled at system level AND for the tenant', async () => {
      mockPrismaService.plugin.findMany.mockResolvedValue([
        { key: 'audit-log' },
        { key: 'sample-plugin' },
      ]);
      // 'integration' is enabled for the tenant but disabled system-wide
      mockTenantClient.plugin.findMany.mockResolvedValue([
        { key: 'sample-plugin' },
        { key: 'integration' },
      ]);

      const result = await service.findEnabledForTenant('acme');

      expect(result).toEqual([{ key: 'sample-plugin' }]);
      expect(mockPrismaService.getTenantClient).toHaveBeenCalledWith('acme');
      expect(mockPrismaService.plugin.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isEnabled: true } }),
      );
      expect(mockTenantClient.plugin.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isEnabled: true } }),
      );
    });

    it('should keep the system ordering (by name) so sidebar menu order stays stable', async () => {
      mockPrismaService.plugin.findMany.mockResolvedValue([{ key: 'audit-log' }, { key: 'sample-plugin' }]);
      mockTenantClient.plugin.findMany.mockResolvedValue([{ key: 'sample-plugin' }, { key: 'audit-log' }]);

      const result = await service.findEnabledForTenant('acme');

      expect(result).toEqual([{ key: 'audit-log' }, { key: 'sample-plugin' }]);
      expect(mockPrismaService.plugin.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('should not expose config, pricing or subscription data', async () => {
      mockPrismaService.plugin.findMany.mockResolvedValue([
        { key: 'sample-plugin', name: 'Sample', price: 10, pricingModel: 'MONTHLY', isEnabled: true },
      ]);
      mockTenantClient.plugin.findMany.mockResolvedValue([
        { key: 'sample-plugin', isEnabled: true, config: { apiKey: 'secret' } },
      ]);

      const result = await service.findEnabledForTenant('acme');

      expect(result).toEqual([{ key: 'sample-plugin' }]);
      expect(mockTenantClient.tenantSubscription.findMany).not.toHaveBeenCalled();
    });
  });

  describe('toggleTenant', () => {
    it('should throw if plugin is not globally enabled', async () => {
      mockPrismaService.plugin.findUnique.mockResolvedValue(null);

      await expect(service.toggleTenant('acme', 'nonexistent', true))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw if plugin is globally disabled', async () => {
      mockPrismaService.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: false,
      });

      await expect(service.toggleTenant('acme', 'sample-plugin', true))
        .rejects.toThrow(BadRequestException);
    });

    it('should enable plugin for tenant when globally enabled (no lifecycle)', async () => {
      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null); // Not yet in tenant
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });

      const result = await service.toggleTenant('acme', 'sample-plugin', true);

      expect(result.isEnabled).toBe(true);
      expect(mockTenantClient.plugin.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'sample-plugin' },
          update: expect.objectContaining({ isEnabled: true }),
          create: expect.objectContaining({ isEnabled: true }),
        }),
      );
    });

    it('should call onInstall on first-time enable and set installedAt', async () => {
      const mockOnInstall = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles['sample-plugin'] = { onInstall: mockOnInstall };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null); // No existing tenant plugin
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(mockOnInstall).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantSlug: 'acme',
          pluginKey: 'sample-plugin',
          pluginVersion: '1.0.0',
        }),
      );
      // DB update should include installedAt
      expect(mockTenantClient.plugin.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ installedAt: expect.any(Date) }),
          create: expect.objectContaining({ installedAt: expect.any(Date) }),
        }),
      );
    });

    it('should call onActivate on re-enable (when installedAt exists)', async () => {
      const mockOnInstall = jest.fn().mockResolvedValue(undefined);
      const mockOnActivate = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles['sample-plugin'] = { onInstall: mockOnInstall, onActivate: mockOnActivate };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: false,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(mockOnActivate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantSlug: 'acme', pluginKey: 'sample-plugin' }),
      );
      expect(mockOnInstall).not.toHaveBeenCalled();
    });

    it('should call onDeactivate when disabling', async () => {
      const mockOnDeactivate = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles['sample-plugin'] = { onDeactivate: mockOnDeactivate };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: false });

      await service.toggleTenant('acme', 'sample-plugin', false);

      expect(mockOnDeactivate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantSlug: 'acme', pluginKey: 'sample-plugin' }),
      );
    });

    it('should block toggle when onInstall throws', async () => {
      mockPluginLifecycles['sample-plugin'] = {
        onInstall: jest.fn().mockRejectedValue(new Error('Install failed')),
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);

      await expect(service.toggleTenant('acme', 'sample-plugin', true))
        .rejects.toThrow(BadRequestException);

      // DB should NOT have been updated
      expect(mockTenantClient.plugin.upsert).not.toHaveBeenCalled();
    });

    it('should block toggle when onDeactivate throws', async () => {
      mockPluginLifecycles['sample-plugin'] = {
        onDeactivate: jest.fn().mockRejectedValue(new Error('Deactivate failed')),
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });

      await expect(service.toggleTenant('acme', 'sample-plugin', false))
        .rejects.toThrow(BadRequestException);

      expect(mockTenantClient.plugin.upsert).not.toHaveBeenCalled();
    });

    it('should apply default config on first install', async () => {
      mockPluginLifecycles['sample-plugin'] = {
        onInstall: jest.fn().mockResolvedValue(undefined),
        getDefaultConfig: () => ({ retentionDays: 90, enableNotifications: false }),
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(mockTenantClient.plugin.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            config: { retentionDays: 90, enableNotifications: false },
          }),
          create: expect.objectContaining({
            config: { retentionDays: 90, enableNotifications: false },
          }),
        }),
      );
    });

    it('should call onUpgrade when version changes during enable', async () => {
      const mockOnUpgrade = jest.fn().mockResolvedValue(undefined);
      const mockOnInstall = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles['sample-plugin'] = { onUpgrade: mockOnUpgrade, onInstall: mockOnInstall };

      const systemPluginV2 = { ...systemPlugin, version: '2.0.0' };
      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPluginV2);
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPluginV2, isEnabled: true });

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(mockOnUpgrade).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantSlug: 'acme',
          pluginKey: 'sample-plugin',
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
        }),
      );
      expect(mockOnInstall).not.toHaveBeenCalled();
    });

    it('should run lifecycle BEFORE DB update (lifecycle-first ordering)', async () => {
      const callOrder: string[] = [];
      mockPluginLifecycles['sample-plugin'] = {
        onInstall: jest.fn().mockImplementation(async () => {
          callOrder.push('onInstall');
        }),
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      mockTenantClient.plugin.upsert.mockImplementation(async () => {
        callOrder.push('upsert');
        return { ...systemPlugin, isEnabled: true };
      });

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(callOrder).toEqual(['onInstall', 'upsert']);
    });

    it('should throw when enabling a plugin with unmet dependencies', async () => {
      mockPluginManifests['sample-plugin'] = {
        key: 'sample-plugin',
        displayName: 'Sample Plugin',
        sdkVersion: '1',
        pluginDependencies: { 'audit-log': '>=1.0.0' },
        pluginConflicts: [],
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      // No enabled plugins → dependency not met
      mockTenantClient.plugin.findMany.mockResolvedValue([]);

      await expect(service.toggleTenant('acme', 'sample-plugin', true))
        .rejects.toThrow(BadRequestException);
      await expect(service.toggleTenant('acme', 'sample-plugin', true))
        .rejects.toThrow('required dependencies not enabled: audit-log');

      expect(mockTenantClient.plugin.upsert).not.toHaveBeenCalled();
    });

    it('should succeed when enabling a plugin with all dependencies met', async () => {
      mockPluginManifests['sample-plugin'] = {
        key: 'sample-plugin',
        displayName: 'Sample Plugin',
        sdkVersion: '1',
        pluginDependencies: { 'audit-log': '>=1.0.0' },
        pluginConflicts: [],
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      // audit-log is enabled → dependency met
      mockTenantClient.plugin.findMany.mockResolvedValue([
        { key: 'audit-log', isEnabled: true },
      ]);
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });

      const result = await service.toggleTenant('acme', 'sample-plugin', true);

      expect(result.isEnabled).toBe(true);
      expect(mockTenantClient.plugin.upsert).toHaveBeenCalled();
    });

    it('should throw when disabling a plugin that others depend on', async () => {
      mockPluginManifests['audit-log'] = {
        key: 'audit-log',
        displayName: 'Audit Log',
        sdkVersion: '1',
        pluginDependencies: { 'sample-plugin': '>=1.0.0' },
        pluginConflicts: [],
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });
      // audit-log is enabled and depends on sample-plugin
      mockTenantClient.plugin.findMany.mockResolvedValue([
        { key: 'sample-plugin', isEnabled: true },
        { key: 'audit-log', isEnabled: true },
      ]);

      await expect(service.toggleTenant('acme', 'sample-plugin', false))
        .rejects.toThrow(BadRequestException);
      await expect(service.toggleTenant('acme', 'sample-plugin', false))
        .rejects.toThrow('other enabled plugins depend on it: audit-log');

      expect(mockTenantClient.plugin.upsert).not.toHaveBeenCalled();
    });

    it('should succeed when disabling a plugin with no dependents', async () => {
      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });
      // No other plugins depend on sample-plugin
      mockTenantClient.plugin.findMany.mockResolvedValue([
        { key: 'sample-plugin', isEnabled: true },
      ]);
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: false });

      const result = await service.toggleTenant('acme', 'sample-plugin', false);

      expect(result.isEnabled).toBe(false);
    });
  });

  describe('toggleTenantUnlocked (shared core for toggle + subscriptions)', () => {
    it('should run the full enable flow without taking the toggle lock', async () => {
      const onInstall = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles['sample-plugin'] = { onInstall, getDefaultConfig: () => ({ retentionDays: 90 }) };
      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });

      await service.toggleTenantUnlocked('acme', 'sample-plugin', true);

      expect(mockLockService.withLock).not.toHaveBeenCalled();
      expect(onInstall).toHaveBeenCalled();
      expect(mockTenantClient.plugin.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ isEnabled: true, config: { retentionDays: 90 } }) }),
      );
      expect(mockCacheService.del).toHaveBeenCalledWith('plugin:tenant:acme:sample-plugin');
    });

    it('should allow disabling for a tenant even when the plugin is disabled system-wide', async () => {
      const onDeactivate = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles['sample-plugin'] = { onDeactivate };
      mockPrismaService.plugin.findUnique.mockResolvedValue({ ...systemPlugin, isEnabled: false });
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: false });

      const result = await service.toggleTenant('acme', 'sample-plugin', false);

      expect(result.isEnabled).toBe(false);
      expect(onDeactivate).toHaveBeenCalled();
    });
  });

  describe('toggleTenant — paid plugins require a subscription', () => {
    const paidPlugin = { ...systemPlugin, pricingModel: 'MONTHLY', price: 10 };
    const DAY = 24 * 60 * 60 * 1000;

    beforeEach(() => {
      mockPrismaService.plugin.findUnique.mockResolvedValue(paidPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...paidPlugin, isEnabled: true });
    });

    it('should reject enabling a paid plugin without any subscription', async () => {
      const onInstall = jest.fn().mockResolvedValue(undefined);
      mockPluginLifecycles['sample-plugin'] = { onInstall };

      await expect(service.toggleTenant('acme', 'sample-plugin', true)).rejects.toThrow(ForbiddenException);
      await expect(service.toggleTenant('acme', 'sample-plugin', true)).rejects.toThrow(/subscri/i);

      expect(mockTenantClient.tenantSubscription.findMany).toHaveBeenCalled();
      expect(onInstall).not.toHaveBeenCalled();
      expect(mockTenantClient.plugin.upsert).not.toHaveBeenCalled();
    });

    it.each(['PENDING_APPROVAL', 'CANCELLED', 'EXPIRED', 'SUSPENDED'])(
      'should reject enabling a paid plugin whose subscription is %s',
      async (status) => {
        mockTenantClient.tenantSubscription.findMany.mockResolvedValue([{ pluginKey: 'sample-plugin', status, trialEndsAt: null }]);

        await expect(service.toggleTenant('acme', 'sample-plugin', true)).rejects.toThrow(ForbiddenException);
        expect(mockTenantClient.plugin.upsert).not.toHaveBeenCalled();
      },
    );

    it('should reject enabling a paid plugin whose TRIAL has already ended', async () => {
      mockTenantClient.tenantSubscription.findMany.mockResolvedValue([{
        pluginKey: 'sample-plugin',
        status: 'TRIAL',
        trialEndsAt: new Date(Date.now() - DAY),
      }]);

      await expect(service.toggleTenant('acme', 'sample-plugin', true)).rejects.toThrow(ForbiddenException);
      expect(mockTenantClient.plugin.upsert).not.toHaveBeenCalled();
    });

    it('should enable a paid plugin with an ACTIVE subscription', async () => {
      mockTenantClient.tenantSubscription.findMany.mockResolvedValue([{ pluginKey: 'sample-plugin', status: 'ACTIVE', trialEndsAt: null }]);

      const result = await service.toggleTenant('acme', 'sample-plugin', true);

      expect(result.isEnabled).toBe(true);
    });

    it('should enable a paid plugin with a running TRIAL subscription', async () => {
      mockTenantClient.tenantSubscription.findMany.mockResolvedValue([{
        pluginKey: 'sample-plugin',
        status: 'TRIAL',
        trialEndsAt: new Date(Date.now() + DAY),
      }]);

      const result = await service.toggleTenant('acme', 'sample-plugin', true);

      expect(result.isEnabled).toBe(true);
    });

    it('should always allow disabling a paid plugin, subscription or not', async () => {
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...paidPlugin, isEnabled: false });

      const result = await service.toggleTenant('acme', 'sample-plugin', false);

      expect(result.isEnabled).toBe(false);
    });

    it('should not look up subscriptions for FREE plugins', async () => {
      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(mockTenantClient.tenantSubscription.findMany).not.toHaveBeenCalled();
    });

    it('should enable a paid plugin that a live app subscription grants', async () => {
      mockTenantClient.tenantSubscription.findMany.mockResolvedValue([
        { pluginKey: 'app:warehouse', status: 'ACTIVE', trialEndsAt: null, grantedPlugins: ['sample-plugin'] },
      ]);

      const result = await service.toggleTenant('acme', 'sample-plugin', true);

      expect(result.isEnabled).toBe(true);
    });

    it('should reject a paid plugin that only a paused app granted', async () => {
      mockTenantClient.tenantSubscription.findMany.mockResolvedValue([
        { pluginKey: 'app:warehouse', status: 'PAUSED', trialEndsAt: null, grantedPlugins: ['sample-plugin'] },
      ]);

      await expect(service.toggleTenant('acme', 'sample-plugin', true)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('toggleTenant — permission provisioning', () => {
    const roles: Record<string, { id: string; name: string }> = {
      ADMIN: { id: 'role-admin', name: 'ADMIN' },
      USER: { id: 'role-user', name: 'USER' },
    };

    beforeEach(() => {
      mockPluginPermissions['sample-plugin'] = [
        { name: 'sample-plugin.item.read', description: 'Read items' },
        { name: 'sample-plugin.item.write', description: 'Write items' },
        { name: 'sample-plugin.report.view', description: 'View reports' },
      ];
      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });
      mockTenantClient.permission.findMany.mockImplementation(async ({ where }: any) =>
        where.name.in.map((name: string) => ({ id: `id:${name}`, name })),
      );
    });

    it('should connect all plugin permissions to ADMIN only, never to USER', async () => {
      mockTenantClient.role.findFirst.mockImplementation(async ({ where }: any) => roles[where.name] ?? null);

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(mockTenantClient.role.update).toHaveBeenCalledTimes(1);
      expect(mockTenantClient.role.update).toHaveBeenCalledWith({
        where: { id: 'role-admin' },
        data: {
          permissions: {
            connect: [
              { id: 'id:sample-plugin.item.read' },
              { id: 'id:sample-plugin.item.write' },
              { id: 'id:sample-plugin.report.view' },
            ],
          },
        },
      });
      expect(mockTenantClient.role.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'role-user' } }),
      );
    });
  });

  describe('lifecycle metrics', () => {
    it('should record metrics on successful onInstall', async () => {
      mockPluginLifecycles['sample-plugin'] = {
        onInstall: jest.fn().mockResolvedValue(undefined),
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(mockMetricsService.record).toHaveBeenCalledWith(
        'sample-plugin',
        'lifecycle.onInstall',
        expect.any(Number),
      );
    });

    it('should record metrics on successful onDeactivate', async () => {
      mockPluginLifecycles['sample-plugin'] = {
        onDeactivate: jest.fn().mockResolvedValue(undefined),
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        installedAt: new Date('2024-01-01'),
        version: '1.0.0',
        config: {},
      });
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: false });

      await service.toggleTenant('acme', 'sample-plugin', false);

      expect(mockMetricsService.record).toHaveBeenCalledWith(
        'sample-plugin',
        'lifecycle.onDeactivate',
        expect.any(Number),
      );
    });

    it('should record error metrics when lifecycle hook fails', async () => {
      const installError = new Error('Install failed');
      mockPluginLifecycles['sample-plugin'] = {
        onInstall: jest.fn().mockRejectedValue(installError),
      };

      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);

      await expect(service.toggleTenant('acme', 'sample-plugin', true))
        .rejects.toThrow(BadRequestException);

      expect(mockMetricsService.record).toHaveBeenCalledWith(
        'sample-plugin',
        'lifecycle.onInstall',
        expect.any(Number),
        installError,
      );
    });
  });

  describe('checkPluginHealth', () => {
    it('should return healthy status for plugins without healthCheck', async () => {
      mockTenantClient.plugin.findMany.mockResolvedValue([
        { key: 'sample-plugin', isEnabled: true, version: '1.0.0', config: {} },
      ]);

      const result = await service.checkPluginHealth('acme');

      expect(result['sample-plugin']).toEqual(
        expect.objectContaining({ status: 'healthy', message: 'No health check defined' }),
      );
    });

    it('should call healthCheck for plugins with lifecycle', async () => {
      mockPluginLifecycles['sample-plugin'] = {
        healthCheck: jest.fn().mockResolvedValue({
          status: 'healthy',
          message: 'All good',
          checkedAt: new Date(),
        }),
      };

      mockTenantClient.plugin.findMany.mockResolvedValue([
        { key: 'sample-plugin', isEnabled: true, version: '1.0.0', config: {} },
      ]);

      const result = await service.checkPluginHealth('acme');

      expect(result['sample-plugin'].status).toBe('healthy');
      expect(mockPluginLifecycles['sample-plugin'].healthCheck).toHaveBeenCalledWith(
        expect.objectContaining({ tenantSlug: 'acme', pluginKey: 'sample-plugin' }),
      );
    });

    it('should return unhealthy status when healthCheck throws', async () => {
      mockPluginLifecycles['sample-plugin'] = {
        healthCheck: jest.fn().mockRejectedValue(new Error('DB connection failed')),
      };

      mockTenantClient.plugin.findMany.mockResolvedValue([
        { key: 'sample-plugin', isEnabled: true, version: '1.0.0', config: {} },
      ]);

      const result = await service.checkPluginHealth('acme');

      expect(result['sample-plugin'].status).toBe('unhealthy');
      expect(result['sample-plugin'].message).toBe('DB connection failed');
    });
  });

  describe('security hardening', () => {
    it('should acquire lock on toggleTenant', async () => {
      mockPrismaService.plugin.findUnique.mockResolvedValue(systemPlugin);
      mockTenantClient.plugin.findUnique.mockResolvedValue(null);
      mockTenantClient.plugin.upsert.mockResolvedValue({ ...systemPlugin, isEnabled: true });

      await service.toggleTenant('acme', 'sample-plugin', true);

      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'toggle:acme:sample-plugin',
        expect.any(Function),
      );
    });

    it('should acquire lock on toggleSystem', async () => {
      mockPrismaService.plugin.upsert.mockResolvedValue({ key: 'sample-plugin', isEnabled: true });

      await service.toggleSystem('sample-plugin', true);

      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'toggle:system:sample-plugin',
        expect.any(Function),
      );
    });

    it('should reject oversized config in updatePluginConfig', async () => {
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        config: {},
      });

      const largeConfig: Record<string, string> = {};
      const largeValue = 'x'.repeat(1024);
      for (let i = 0; i < 65; i++) {
        largeConfig[`key${i}`] = largeValue;
      }

      await expect(service.updatePluginConfig('acme', 'sample-plugin', largeConfig))
        .rejects.toThrow(BadRequestException);
    });

    it('a config update keeps the keys it does not send (e.g. a switch another page owns)', async () => {
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        config: { googleCalendar: { enabled: true }, webhookTimeoutMs: 5000 },
      });
      mockTenantClient.plugin.update.mockResolvedValue({});

      await service.updatePluginConfig('acme', 'sample-plugin', { webhookTimeoutMs: 8000 });

      expect(mockTenantClient.plugin.update).toHaveBeenCalledWith({
        where: { key: 'sample-plugin' },
        data: { config: { googleCalendar: { enabled: true }, webhookTimeoutMs: 8000 } },
      });
    });

    it('should redact sensitive config in event payload', async () => {
      mockTenantClient.plugin.findUnique.mockResolvedValue({
        key: 'sample-plugin',
        isEnabled: true,
        config: { apiKey: 'old-secret', name: 'test' },
      });
      mockTenantClient.plugin.update.mockResolvedValue({
        key: 'sample-plugin',
        config: { apiKey: 'new-secret', name: 'test' },
      });

      await service.updatePluginConfig('acme', 'sample-plugin', { apiKey: 'new-secret', name: 'test' });

      expect(mockPluginEventService.emit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          previousConfig: expect.objectContaining({ apiKey: '[REDACTED]', name: 'test' }),
          newConfig: expect.objectContaining({ apiKey: '[REDACTED]', name: 'test' }),
        }),
      );
    });

    it('should log warning for permission namespace violations in syncPlugins', async () => {
      mockPrismaService.plugin.upsert.mockResolvedValue({});
      mockPluginPermissions['sample-plugin'] = [
        { name: 'sample-plugin.read', description: 'Read' },
        { name: 'wrong-namespace.write', description: 'Write' },
      ];

      // Spy on Logger.error
      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      await service.syncPlugins();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('wrong-namespace.write'),
      );
    });
  });
});
