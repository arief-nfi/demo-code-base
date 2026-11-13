import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import type { TenantContext, AuthenticatedUser } from '../types';

// Extend Express Request to include tenant context
// Note: User type is extended via Passport's Express.User interface
declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
    // Extend Passport's User interface with our auth fields
    interface User extends AuthenticatedUser {}
  }
}

const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Tenant statuses whose users can't use the app at all: the middleware answers
 * 401 'Tenant is inactive' (SUSPENDED / TERMINATED get a 403 and the client's
 * /tenant-suspended page instead). Login and token refresh must reject these too,
 * or the client loops: refresh → retry → 401 → /login → bounced to / → …
 */
export function isTenantInactive(status: string): boolean {
  return !['ACTIVE', 'TRIAL', 'SUSPENDED', 'TERMINATED'].includes(status);
}

@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      return next();
    }

    // Check shared cache first
    const cacheKey = `tenant:context:${tenantId}`;
    const cached = await this.cache.get<TenantContext>(cacheKey);
    if (cached) {
      this.checkTenantAccess(cached);
      req.tenant = cached;
      return next();
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new UnauthorizedException('Tenant not found');
    }

    const tenantContext: TenantContext = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      trialEndsAt: tenant.trialEndsAt,
      suspendedReason: tenant.suspendedReason,
      terminationDate: tenant.terminationDate,
      onboardingCompleted: tenant.onboardingCompleted,
    };

    // Lazy trial expiry: if TRIAL and trialEndsAt has passed, suspend the tenant
    if (tenant.status === 'TRIAL' && tenant.trialEndsAt && tenant.trialEndsAt < new Date()) {
      const suspendData = {
        status: 'SUSPENDED' as const,
        suspendedAt: new Date(),
        suspendedReason: 'trial_expired',
      };
      await this.prisma.tenant.update({ where: { id: tenant.id }, data: suspendData });
      try {
        const tenantClient = this.prisma.getTenantClient(tenant.slug);
        await tenantClient.tenant.update({ where: { id: tenant.id }, data: suspendData });
      } catch {
        // best-effort sync to tenant schema
      }
      // Invalidate cache so next request picks up new status
      await this.cache.del(cacheKey);

      tenantContext.status = 'SUSPENDED';
      tenantContext.suspendedReason = 'trial_expired';
    }

    await this.cache.set(cacheKey, tenantContext, CACHE_TTL_MS);
    this.checkTenantAccess(tenantContext);

    req.tenant = tenantContext;
    next();
  }

  private checkTenantAccess(tenant: TenantContext): void {
    if (isTenantInactive(tenant.status)) {
      throw new UnauthorizedException('Tenant is inactive');
    }

    switch (tenant.status) {
      case 'ACTIVE':
      case 'TRIAL':
        // Check if trial expired (cached context may be stale)
        if (
          tenant.status === 'TRIAL' &&
          tenant.trialEndsAt &&
          new Date(tenant.trialEndsAt) < new Date()
        ) {
          throw new ForbiddenException({
            statusCode: 403,
            message: 'Tenant suspended',
            reason: 'trial_expired',
          });
        }
        return; // allow

      case 'SUSPENDED':
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Tenant suspended',
          reason: tenant.suspendedReason || 'unknown',
        });

      case 'TERMINATED':
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Tenant terminated',
          terminationDate: tenant.terminationDate,
        });
    }
  }
}
