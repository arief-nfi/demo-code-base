import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
import { JwtAuthGuard, PrismaService } from '@saas/backend';
import type { TenantContext } from '@saas/backend';
import { TenantAppsController } from './tenant-apps.controller';
import { TenantAppsService } from './tenant-apps.service';

describe('TenantAppsController (routes)', () => {
  let app: INestApplication;
  let role: 'USER' | 'ADMIN';
  const service = {
    store: jest.fn(async () => []),
    preview: jest.fn(async () => ({ plugins: [] })),
    menu: jest.fn(async () => [{ key: 'warehouse', name: 'Warehouse', icon: 'warehouse', plugins: ['inventory'] }]),
  };
  // The real RbacGuard loads the caller's roles through PrismaService
  const tenantClient = { user: { findUnique: jest.fn(async () => ({ id: 'user-1', roles: [{ name: role, permissions: [] }] })) } };
  const prisma = { getTenantClient: jest.fn(() => tenantClient) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantAppsController],
      providers: [
        { provide: TenantAppsService, useValue: service },
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { userId: 'user-1', tenantSlug: 'acme' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.tenant = { id: 't1', slug: 'acme' } as TenantContext;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('menu is readable by a plain tenant user; store and preview are admin only', async () => {
    role = 'USER';
    const res = await request(app.getHttpServer()).get('/tenant-apps/menu').expect(200);
    expect(res.body).toEqual([{ key: 'warehouse', name: 'Warehouse', icon: 'warehouse', plugins: ['inventory'] }]);
    await request(app.getHttpServer()).get('/tenant-apps').expect(403);
    await request(app.getHttpServer()).get('/tenant-apps/warehouse/preview').expect(403);
  });

  it('an admin gets the store and a preview for its tenant', async () => {
    role = 'ADMIN';
    await request(app.getHttpServer()).get('/tenant-apps').expect(200);
    await request(app.getHttpServer()).get('/tenant-apps/warehouse/preview').expect(200);
    expect(service.store).toHaveBeenCalledWith('acme', 't1');
    expect(service.preview).toHaveBeenCalledWith('acme', 't1', 'warehouse');
  });
});
