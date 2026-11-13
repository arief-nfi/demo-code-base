import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const RBAC_MODE_KEY = 'rbac_mode';
export type RbacMode = 'AND' | 'OR';
export const RbacMode = (mode: RbacMode) => SetMetadata(RBAC_MODE_KEY, mode);
