import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { ApiKeyScopeGuard, API_KEY_SCOPES_KEY } from './api-key-scope.guard';

// ─── ApiKeyAuthGuard ─────────────────────────────────────

describe('ApiKeyAuthGuard', () => {
  let guard: ApiKeyAuthGuard;

  const mockApiKeysService = {
    validateApiKey: jest.fn(),
  };

  const mockModuleRef = {
    get: jest.fn().mockReturnValue(mockApiKeysService),
  };

  function createContext(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ApiKeyAuthGuard(mockModuleRef as unknown as ModuleRef);
  });

  it('should attach partner and scopes to request and return true for valid key', async () => {
    const mockRequest: Record<string, unknown> = {
      headers: { 'x-api-key': 'intk_test' },
      tenant: { slug: 'test-tenant' },
    };
    const context = createContext(mockRequest);

    mockApiKeysService.validateApiKey.mockResolvedValue({
      partnerId: 'p1',
      partnerCode: 'acme',
      partnerName: 'Acme Corp',
      scopes: ['webhook.trigger', '*'],
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockRequest.partner).toEqual({
      id: 'p1',
      code: 'acme',
      name: 'Acme Corp',
    });
    expect(mockRequest.apiKeyScopes).toEqual(['webhook.trigger', '*']);
    expect(mockApiKeysService.validateApiKey).toHaveBeenCalledWith('intk_test', 'test-tenant');
  });

  it('should throw UnauthorizedException when API key header is missing', async () => {
    const mockRequest = {
      headers: {},
      tenant: { slug: 'test-tenant' },
    };
    const context = createContext(mockRequest);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when tenant context is missing', async () => {
    const mockRequest = {
      headers: { 'x-api-key': 'intk_test' },
    };
    const context = createContext(mockRequest);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when ModuleRef.get fails (service not available)', async () => {
    const mockRequest = {
      headers: { 'x-api-key': 'intk_test' },
      tenant: { slug: 'test-tenant' },
    };
    const context = createContext(mockRequest);

    mockModuleRef.get.mockImplementation(() => {
      throw new Error('Provider not found');
    });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should propagate error when validateApiKey throws', async () => {
    const mockRequest = {
      headers: { 'x-api-key': 'intk_test' },
      tenant: { slug: 'test-tenant' },
    };
    const context = createContext(mockRequest);

    mockApiKeysService.validateApiKey.mockRejectedValue(
      new UnauthorizedException('Invalid API key'),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});

// ─── ApiKeyScopeGuard ────────────────────────────────────

describe('ApiKeyScopeGuard', () => {
  let guard: ApiKeyScopeGuard;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  function createContext(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ApiKeyScopeGuard(mockReflector as unknown as Reflector);
  });

  it('should return true when no required scopes are defined', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createContext({ apiKeyScopes: [] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return true when request has wildcard scope', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['webhook.trigger']);
    const context = createContext({ apiKeyScopes: ['*'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return true when request has matching scope', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['webhook.trigger']);
    const context = createContext({ apiKeyScopes: ['webhook.trigger', 'data.read'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException when scope is missing', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['webhook.trigger']);
    const context = createContext({ apiKeyScopes: ['data.read'] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
