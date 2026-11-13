export const API_KEYS_SERVICE_TOKEN = Symbol('API_KEYS_SERVICE');

export interface ApiKeyValidationResult {
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  scopes: string[];
}

export interface IApiKeyValidationService {
  validateApiKey(rawKey: string, tenantSlug: string): Promise<ApiKeyValidationResult>;
}
