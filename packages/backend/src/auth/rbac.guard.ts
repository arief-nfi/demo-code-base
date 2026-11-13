import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_KEY, PERMISSIONS_KEY, RBAC_MODE_KEY, RbacMode } from './rbac.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles && !requiredPermissions) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.userId) {
      return false;
    }

    const prismaClient = user.tenantSlug
      ? this.prisma.getTenantClient(user.tenantSlug)
      : this.prisma;

    const userWithRoles = await prismaClient.user.findUnique({
      where: { id: user.userId },
      include: {
        roles: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!userWithRoles) {
      return false;
    }

    const userRoles = userWithRoles.roles.map((r) => r.name);

    if (userRoles.some(role => role.toUpperCase() === 'SYSADMIN')) {
      return true;
    }

    const userPermissions = new Set(
      userWithRoles.roles.flatMap((r) => r.permissions.map((p) => p.name)),
    );

    const mode = this.reflector.getAllAndOverride<RbacMode>(RBAC_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || 'OR';

    const hasRole = () => requiredRoles ? requiredRoles.some((role: string) => userRoles.some(ur => ur.toUpperCase() === role.toUpperCase())) : true;
    const hasPermission = () => requiredPermissions ? requiredPermissions.some((perm: string) => Array.from(userPermissions).some(up => up.toUpperCase() === perm.toUpperCase())) : true;

    // If only roles are required
    if (requiredRoles && !requiredPermissions) {
        return hasRole();
    }
    
    // If only permissions are required
    if (!requiredRoles && requiredPermissions) {
        return hasPermission();
    }

    // If both are required
    if (mode === 'OR') {
      return hasRole() || hasPermission();
    } else {
      // AND
      return hasRole() && hasPermission();
    }
  }
}
