import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { API_KEYS_SERVICE_TOKEN } from './api-key.interface';
import type { IApiKeyValidationService } from './api-key.interface';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException('API key required');
    }

    const tenantSlug: string | undefined = request.tenant?.slug;
    if (!tenantSlug) {
      throw new UnauthorizedException('Tenant context required');
    }

    let apiKeysService: IApiKeyValidationService;
    try {
      apiKeysService = this.moduleRef.get<IApiKeyValidationService>(
        API_KEYS_SERVICE_TOKEN,
        { strict: false },
      );
    } catch {
      throw new UnauthorizedException('API key authentication is not available');
    }

    const result = await apiKeysService.validateApiKey(apiKey, tenantSlug);

    request.partner = {
      id: result.partnerId,
      code: result.partnerCode,
      name: result.partnerName,
    };
    request.apiKeyScopes = result.scopes;

    return true;
  }
}
