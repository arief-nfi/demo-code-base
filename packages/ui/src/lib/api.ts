import { useAuthStore } from '../stores/auth-store';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Build common headers for API requests.
 * The JWT token is sent automatically via HttpOnly cookie (credentials: 'include'),
 * so we only need to attach non-sensitive headers here.
 */
export const getAuthHeaders = () => {
  if (typeof window === 'undefined') return {};

  const tenantId = useAuthStore.getState().tenantId;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (tenantId) {
    headers['x-tenant-id'] = tenantId;
  }

  return headers;
};
