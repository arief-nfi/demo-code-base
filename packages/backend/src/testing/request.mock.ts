import type { AuthenticatedRequest, TenantContext } from '../types';

/**
 * Creates a mock AuthenticatedRequest with sensible defaults.
 *
 * Usage:
 * ```typescript
 * const req = createMockRequest();
 * const req = createMockRequest({ tenant: { slug: 'custom' } });
 * ```
 */
export function createMockRequest(
  overrides?: Partial<{ user: Partial<Express.User>; tenant: Partial<TenantContext> }>,
): AuthenticatedRequest {
  const now = new Date();
  return {
    user: {
      userId: 'test-user-id',
      username: 'testuser',
      tenantId: 'test-tenant-id',
      tenantSlug: 'test-tenant',
      ...overrides?.user,
    },
    tenant: {
      id: 'test-tenant-id',
      slug: 'test-tenant',
      name: 'Test Tenant',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      ...overrides?.tenant,
    },
    ...({} as any),
  } as unknown as AuthenticatedRequest;
}
