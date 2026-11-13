import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const API_KEY_SCOPES_KEY = 'apiKeyScopes';

export const RequiredScopes = (...scopes: string[]) =>
  SetMetadata(API_KEY_SCOPES_KEY, scopes);

@Injectable()
export class ApiKeyScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      API_KEY_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes?.length) return true;

    const request = context.switchToHttp().getRequest();
    const requestScopes: string[] = request.apiKeyScopes || [];

    if (requestScopes.includes('*')) return true;

    const hasScope = requiredScopes.some((scope) =>
      requestScopes.includes(scope),
    );

    if (!hasScope) {
      throw new ForbiddenException('Insufficient API key scope');
    }

    return true;
  }
}
