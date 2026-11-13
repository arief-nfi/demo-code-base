import { Reflector } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AUDIT_METADATA_KEY } from './audit.decorator';
import type { ExecutionContext, CallHandler } from '@nestjs/common';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let reflector: Reflector;
  let mockAuditService: { log: jest.Mock };

  function createMockContext(overrides: {
    params?: Record<string, string>;
    user?: Record<string, string | undefined> | null;
    tenant?: { slug?: string };
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    ip?: string;
  } = {}): ExecutionContext {
    const request = {
      params: overrides.params ?? {},
      user: 'user' in overrides ? overrides.user : { userId: 'user-1', tenantSlug: 'acme' },
      tenant: overrides.tenant ?? { slug: 'acme' },
      url: overrides.url ?? '/system/users',
      method: overrides.method ?? 'GET',
      headers: {
        'user-agent': 'jest-test',
        ...overrides.headers,
      },
      ip: overrides.ip ?? '127.0.0.1',
      connection: { remoteAddress: overrides.ip ?? '127.0.0.1' },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn() as any,
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(responseBody: unknown = {}): CallHandler {
    return { handle: () => of(responseBody) };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
    mockAuditService = { log: jest.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(reflector, mockAuditService as any);
  });

  // ─── Pass-through when no metadata ────────────────────

  it('should pass through when no @Audit() metadata is present', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    const context = createMockContext();
    const handler = createMockCallHandler({ id: '123' });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).toEqual({ id: '123' });
    expect(mockAuditService.log).not.toHaveBeenCalled();
  });

  // ─── Basic READ audit ─────────────────────────────────

  it('should log a READ audit entry with params.id', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'User',
    });
    const context = createMockContext({ params: { id: 'user-42' } });
    const handler = createMockCallHandler({ id: 'user-42', name: 'John' });

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith({
      action: 'READ',
      entity: 'User',
      entityId: 'user-42',
      userId: 'user-1',
      tenantSlug: 'acme',
      metadata: {
        requestUrl: '/system/users',
        requestMethod: 'GET',
        requestIp: '127.0.0.1',
        userAgent: 'jest-test',
      },
    });
  });

  // ─── entityId fallback: response body .id ──────────────

  it('should extract entityId from response body when params.id is absent', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'Role',
    });
    const context = createMockContext({ params: {} });
    const handler = createMockCallHandler({ id: 'role-99', name: 'Admin' });

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'role-99' }),
    );
  });

  // ─── entityId fallback: 'list' ─────────────────────────

  it('should default entityId to "list" for paginated responses', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'User',
    });
    const context = createMockContext({ params: {} });
    const handler = createMockCallHandler({ data: [], total: 0 });

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'list' }),
    );
  });

  // ─── entityId fallback: array response ─────────────────

  it('should default entityId to "list" when response is an array', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'Permission',
    });
    const context = createMockContext({ params: {} });
    const handler = createMockCallHandler([{ id: '1' }, { id: '2' }]);

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'list' }),
    );
  });

  // ─── Decorator entityId override ───────────────────────

  it('should use decorator entityId override when provided', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'Dashboard',
      entityId: 'summary',
    });
    const context = createMockContext({ params: { id: 'ignored' } });
    const handler = createMockCallHandler({});

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'summary' }),
    );
  });

  // ─── No changes field for READ ─────────────────────────

  it('should not include a changes field for READ actions', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'User',
    });
    const context = createMockContext({ params: { id: 'user-1' } });
    const handler = createMockCallHandler({ id: 'user-1' });

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    const logCall = mockAuditService.log.mock.calls[0][0];
    expect(logCall.changes).toBeUndefined();
  });

  // ─── Metadata fields ───────────────────────────────────

  it('should include all metadata fields', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'User',
    });
    const context = createMockContext({
      params: { id: 'user-1' },
      url: '/api/system/users/user-1',
      method: 'GET',
      headers: { 'user-agent': 'Mozilla/5.0' },
      ip: '192.168.1.100',
    });
    const handler = createMockCallHandler({ id: 'user-1' });

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          requestUrl: '/api/system/users/user-1',
          requestMethod: 'GET',
          requestIp: '192.168.1.100',
          userAgent: 'Mozilla/5.0',
        },
      }),
    );
  });

  // ─── X-Forwarded-For IP extraction ─────────────────────

  it('should prefer x-forwarded-for header for IP extraction', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'User',
    });
    const context = createMockContext({
      params: { id: 'user-1' },
      headers: {
        'user-agent': 'test',
        'x-forwarded-for': '10.0.0.1, 10.0.0.2',
      },
      ip: '127.0.0.1',
    });
    const handler = createMockCallHandler({ id: 'user-1' });

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          requestIp: '10.0.0.1',
        }),
      }),
    );
  });

  // ─── Tenant slug from request.tenant ───────────────────

  it('should extract tenantSlug from req.tenant.slug', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'User',
    });
    const context = createMockContext({
      params: { id: 'u-1' },
      tenant: { slug: 'beta-corp' },
      user: { userId: 'u-admin' },
    });
    const handler = createMockCallHandler({ id: 'u-1' });

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ tenantSlug: 'beta-corp' }),
    );
  });

  // ─── Audit failure does not break response ─────────────

  it('should not break the response when AuditService.log() fails', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'User',
    });
    mockAuditService.log.mockRejectedValueOnce(new Error('DB connection lost'));
    const context = createMockContext({ params: { id: 'user-1' } });
    const handler = createMockCallHandler({ id: 'user-1', name: 'Jane' });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).toEqual({ id: 'user-1', name: 'Jane' });
    await new Promise(process.nextTick);
    expect(mockAuditService.log).toHaveBeenCalled();
  });

  // ─── Missing user context ──────────────────────────────

  it('should handle missing user gracefully', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({
      action: 'READ',
      entity: 'User',
    });
    const context = createMockContext({
      params: { id: 'u-1' },
      user: null,
      tenant: { slug: 'acme' },
    });
    const handler = createMockCallHandler({ id: 'u-1' });

    await lastValueFrom(interceptor.intercept(context, handler));
    await new Promise(process.nextTick);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: undefined }),
    );
  });
});
