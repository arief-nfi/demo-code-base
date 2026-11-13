import { Test, TestingModule } from '@nestjs/testing';
import { Type, ModuleMetadata } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { PluginEventService } from '../events/plugin-event.service';

export interface PluginTestContext {
  module: TestingModule;
  prisma: jest.Mocked<PrismaService>;
  cache: jest.Mocked<CacheService>;
  events: jest.Mocked<PluginEventService>;
}

/**
 * Creates a test module for a plugin with mocked core services.
 *
 * Usage:
 * ```typescript
 * const ctx = await createPluginTestModule(SampleItemsModule);
 * const controller = ctx.module.get(SampleItemsController);
 * ```
 */
export async function createPluginTestModule(
  pluginModule: Type<any>,
  overrides?: Partial<ModuleMetadata>,
): Promise<PluginTestContext> {
  const mockPrisma = createMockPrismaService();
  const mockCache = createMockCacheService();
  const mockEvents = createMockPluginEventService();

  const builder = Test.createTestingModule({
    imports: [pluginModule],
    ...overrides,
  })
    .overrideProvider(PrismaService).useValue(mockPrisma)
    .overrideProvider(CacheService).useValue(mockCache)
    .overrideProvider(PluginEventService).useValue(mockEvents);

  const module = await builder.compile();

  return {
    module,
    prisma: mockPrisma,
    cache: mockCache,
    events: mockEvents,
  };
}

/**
 * Creates a mock PrismaService with tenant client simulation.
 */
export function createMockPrismaService(): jest.Mocked<PrismaService> {
  const tenantClients = new Map<string, any>();

  const mock = {
    getTenantClient: jest.fn((slug: string) => {
      if (!tenantClients.has(slug)) {
        tenantClients.set(slug, createMockTenantClient());
      }
      return tenantClients.get(slug);
    }),
    plugin: createMockPrismaDelegate(),
    tenant: createMockPrismaDelegate(),
    tenantConfig: createMockPrismaDelegate(),
  } as unknown as jest.Mocked<PrismaService>;

  return mock;
}

/**
 * Creates a Proxy-based mock tenant client that auto-creates delegates.
 */
export function createMockTenantClient() {
  const delegates = new Map<string, ReturnType<typeof createMockPrismaDelegate>>();

  return new Proxy({} as Record<string, any>, {
    get(_target, prop) {
      if (typeof prop === 'string' && !prop.startsWith('_') && prop !== 'then') {
        if (!delegates.has(prop)) {
          delegates.set(prop, createMockPrismaDelegate());
        }
        return delegates.get(prop);
      }
      return undefined;
    },
  });
}

/**
 * Creates a mock Prisma delegate with common CRUD operations.
 */
export function createMockPrismaDelegate() {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'mock-id', ...data })),
    update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    delete: jest.fn().mockResolvedValue({}),
    count: jest.fn().mockResolvedValue(0),
    upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
}

/**
 * Creates a mock CacheService matching the actual API (get, set, del, delPattern).
 */
export function createMockCacheService(): jest.Mocked<CacheService> {
  const store = new Map<string, any>();
  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: any) => { store.set(key, value); return Promise.resolve(); }),
    del: jest.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
    delPattern: jest.fn((pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
      }
      return Promise.resolve();
    }),
    getStats: jest.fn(() => ({ size: store.size, backend: 'memory' as const, connected: undefined })),
    isRedisConnected: jest.fn(() => false),
    onModuleDestroy: jest.fn(),
  } as unknown as jest.Mocked<CacheService>;
}

/**
 * Creates a mock PluginEventService matching the actual API (emit, emitAsync).
 */
export function createMockPluginEventService(): jest.Mocked<PluginEventService> {
  return {
    emit: jest.fn(),
    emitAsync: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PluginEventService>;
}
