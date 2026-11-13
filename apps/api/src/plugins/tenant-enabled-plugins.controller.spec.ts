import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
import { JwtAuthGuard, PrismaService, PluginMetricsService, ROLES_KEY, PERMISSIONS_KEY } from '@saas/backend';
import type { TenantContext } from '@saas/backend';
import { PluginsModule } from './plugins.module';
import { PluginsService } from './plugins.service';
import { TenantEnabledPluginsController } from './tenant-enabled-plugins.controller';
import { TenantPluginsController } from './tenant-plugins.controller';

// Keep the real plugin registry (and every plugin's API module) out of this test
jest.mock('../plugin-registry', () => ({
  PluginList: [],
  PluginLifecycles: {},
  PluginConfigSchemas: {},
  PluginManifests: {},
  PluginPermissions: {},
}));

const mockPluginsService = {
  findEnabledForTenant: jest.fn(),
  findAllTenant: jest.fn(),
};

// The real RbacGuard loads the caller's roles/permissions through PrismaService
const mockTenantClient = { user: { findUnique: jest.fn() } };
const mockPrisma = { getTenantClient: jest.fn(() => mockTenantClient) };

describe('TenantEnabledPluginsController metadata', () => {
  it('should only require authentication (JwtAuthGuard), with no role/permission requirement', () => {
    const handler = TenantEnabledPluginsController.prototype.findEnabled;

    expect(Reflect.getMetadata(GUARDS_METADATA, TenantEnabledPluginsController)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, TenantEnabledPluginsController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
  });

  it('should be registered before TenantPluginsController so no future /tenant-plugins/:key route can shadow it', () => {
    const controllers: unknown[] = Reflect.getMetadata('controllers', PluginsModule);

    expect(controllers).toContain(TenantEnabledPluginsController);
    expect(controllers.indexOf(TenantEnabledPluginsController)).toBeLessThan(
      controllers.indexOf(TenantPluginsController),
    );
  });
});

describe('Tenant plugin routes (integration)', () => {
  let app: INestApplication;
  let authenticated: boolean;
  let tenant: { slug: string } | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // Exactly the controllers PluginsModule registers, in its order (route precedence)
      controllers: Reflect.getMetadata('controllers', PluginsModule),
      providers: [
        { provide: PluginsService, useValue: mockPluginsService },
        { provide: PluginMetricsService, useValue: {} },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!authenticated) throw new UnauthorizedException();
          ctx.switchToHttp().getRequest().user = { userId: 'user-1', tenantSlug: 'acme' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Stand-in for TenancyMiddleware
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.tenant = tenant as TenantContext | undefined;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    tenant = { slug: 'acme' };
    // Caller is a plain USER (not ADMIN) holding a plugin read permission
    mockTenantClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'USER', permissions: [{ name: 'sample-plugin.item.read' }] }],
    });
    mockPluginsService.findEnabledForTenant.mockResolvedValue([{ key: 'sample-plugin' }]);
  });

  it('GET /tenant-plugins/enabled returns the enabled plugin keys to a non-ADMIN user', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-plugins/enabled');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'sample-plugin' }]);
    expect(mockPluginsService.findEnabledForTenant).toHaveBeenCalledWith('acme');
  });

  it('GET /tenant-plugins/enabled rejects unauthenticated requests', async () => {
    authenticated = false;

    const res = await request(app.getHttpServer()).get('/tenant-plugins/enabled');

    expect(res.status).toBe(401);
    expect(mockPluginsService.findEnabledForTenant).not.toHaveBeenCalled();
  });

  it('GET /tenant-plugins/enabled returns 400 without a tenant context', async () => {
    tenant = undefined;

    const res = await request(app.getHttpServer()).get('/tenant-plugins/enabled');

    expect(res.status).toBe(400);
    expect(mockPluginsService.findEnabledForTenant).not.toHaveBeenCalled();
  });

  it('GET /tenant-plugins (full admin listing) stays ADMIN-only', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-plugins');

    expect(res.status).toBe(403);
    expect(mockPluginsService.findAllTenant).not.toHaveBeenCalled();
  });
});
