import type { Request } from 'express';

// ─── JWT & Auth Types ────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;        // userId
  username: string;
  tenantId: string;
  tenantSlug: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  userId: string;
  username: string;
  tenantId: string;
  tenantSlug: string;
}

// ─── Tenant Types ────────────────────────────────────────────────────────────

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  trialEndsAt?: Date | null;
  suspendedReason?: string | null;
  terminationDate?: Date | null;
  onboardingCompleted?: boolean;
}

// ─── Express Request Extensions ──────────────────────────────────────────────
// Express.User is extended globally in tenancy.middleware.ts to include AuthenticatedUser fields.
// AuthenticatedRequest enforces that `user` is present (non-optional) for guarded routes.

export interface AuthenticatedRequest extends Request {
  user: Express.User;
  tenant?: TenantContext;
  partner?: {
    id: string;
    code: string;
    name: string;
  };
  apiKeyScopes?: string[];
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  errors?: Record<string, unknown>;
  timestamp?: string;
}

// ─── Query Types ─────────────────────────────────────────────────────────────

export interface BaseQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ─── User Types (without password) ──────────────────────────────────────────

export interface ValidatedUser {
  id: string;
  email: string;
  username: string;
  name: string | null;
  avatar: string | null;
  status: string;
  roles: Array<{
    id: string;
    name: string;
    description: string | null;
    permissions: Array<{
      id: string;
      name: string;
      description: string | null;
    }>;
  }>;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantDescription?: string | null;
  tenantLogo?: string | null;
  tenantIcon?: string | null;
  tenantTheme?: string | null;
  tenantLanguage?: string | null;
  tenantPrimaryColor?: string | null;
  tenantAccentColor?: string | null;
  tenantSidebarBackground?: string | null;
  tenantSidebarForeground?: string | null;
  onboardingCompleted?: boolean;
}
