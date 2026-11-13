'use client';

import { API_URL, getAuthHeaders } from './api';
import { useAuthStore } from '../stores/auth-store';
import { useRBACStore } from '../stores/rbac-store';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
}

export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * The request got no response at all: the browser is offline, or the API is
 * down or unreachable. A TypeError, like the fetch failure it replaces.
 */
export class ApiNetworkError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

/** fetch, with "no response" failures thrown as ApiNetworkError (aborts stay as they are). */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw err instanceof TypeError ? new ApiNetworkError(err.message) : err;
  }
}

/** 403 messages for which the client redirects to /tenant-suspended. */
const TENANT_STATUS_MESSAGES = ['Tenant suspended', 'Tenant terminated'];

/**
 * True when the request that threw `err` already started a full-page redirect
 * (401 → /login, suspended/terminated tenant → /tenant-suspended). Callers
 * should keep showing a neutral state rather than an error while it lands.
 */
export function isAuthRedirectError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.statusCode === 401 || (err.statusCode === 403 && TENANT_STATUS_MESSAGES.includes(err.message)))
  );
}

// ─── Token Refresh ──────────────────────────────────────────────────────────

/** Deduplication: only one refresh request at a time across all concurrent calls. */
let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  try {
    const tenantSlug = useAuthStore.getState().tenantSlug;
    console.debug('[auth] attempting refresh', { tenantSlug, apiUrl: API_URL });
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug }),
    });

    if (res.ok) {
      console.debug('[auth] refresh ok', res.status);
      try {
        const data = await res.json();
        if (data?.user?.roles && data?.user?.permissions) {
          useRBACStore.getState().setRBAC(data.user.roles, data.user.permissions);
        }
      } catch {
        // Non-critical: response parsing failed, but token refresh still succeeded
      }
      return true;
    }
    let body: unknown;
    try { body = await res.clone().json(); } catch { body = await res.text().catch(() => ''); }
    console.warn('[auth] refresh failed', { status: res.status, body });
    return false;
  } catch (err) {
    console.warn('[auth] refresh threw', err);
    return false;
  }
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined') {
    // Clear stale auth data to prevent redirect loops
    useAuthStore.getState().clearSession();
    useRBACStore.getState().clear();
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?returnUrl=${returnUrl}`;
  }
}

/**
 * Revoke the session on the API, clear local auth state, and load /login.
 * A full page load, not a router push: a soft navigation lets the current page
 * re-render with the cleared RBAC store and flash "Access Denied" first.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // Sign out locally even if the request fails
  }
  useAuthStore.getState().clearSession();
  useRBACStore.getState().clear();
  window.location.href = '/login';
}

// ─── Core Request Function ──────────────────────────────────────────────────

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;

  const isFormData = options.body instanceof FormData;
  const baseHeaders = getAuthHeaders();

  // For FormData uploads, remove Content-Type so the browser sets the
  // multipart boundary automatically.
  if (isFormData) {
    delete baseHeaders['Content-Type'];
  }

  const headers = {
    ...baseHeaders,
    ...options.headers,
  };

  // credentials: 'include' sends the HttpOnly cookie automatically
  const res = await send(url, { ...options, headers, credentials: 'include' });

  // Handle 401 — attempt transparent token refresh before redirecting
  if (res.status === 401) {
    console.debug('[auth] 401 on', endpoint);

    // Don't try to refresh if this IS the refresh endpoint (avoid infinite loop)
    if (endpoint === '/auth/refresh' || endpoint.endsWith('/auth/refresh')) {
      redirectToLogin();
      throw new ApiRequestError(401, 'Unauthorized');
    }

    // Deduplicate: reuse an in-flight refresh if one exists
    if (!refreshPromise) {
      refreshPromise = attemptRefresh();
    }

    let refreshed: boolean;
    try {
      refreshed = await refreshPromise;
    } finally {
      refreshPromise = null;
    }

    if (refreshed) {
      console.debug('[auth] retrying', endpoint);
      const retryRes = await send(url, { ...options, headers, credentials: 'include' });
      console.debug('[auth] retry result', endpoint, retryRes.status);
      return handleResponse<T>(retryRes);
    }

    console.warn('[auth] refresh failed, redirecting to login');
    redirectToLogin();
    throw new ApiRequestError(401, 'Unauthorized');
  }

  // Handle 403 — check for tenant suspension/termination
  if (res.status === 403) {
    try {
      const body = await res.clone().json();
      if (TENANT_STATUS_MESSAGES.includes(body.message)) {
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams({ status: body.message });
          if (body.reason) params.set('reason', body.reason);
          if (body.terminationDate) params.set('terminationDate', body.terminationDate);
          window.location.href = `/tenant-suspended?${params.toString()}`;
        }
        throw new ApiRequestError(403, body.message);
      }
    } catch (e) {
      if (e instanceof ApiRequestError) throw e;
      // Not a tenant status error, fall through to normal handling
    }
  }

  return handleResponse<T>(res);
}

async function handleResponse<T>(res: Response): Promise<T> {
  // Handle 401 on retry — don't attempt refresh again, just redirect
  if (res.status === 401) {
    redirectToLogin();
    throw new ApiRequestError(401, 'Unauthorized');
  }

  // Handle no-content responses
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') || '';

  // Handle non-JSON responses (e.g., CSV exports)
  if (!contentType.includes('application/json')) {
    if (!res.ok) {
      throw new ApiRequestError(res.status, `Request failed with status ${res.status}`);
    }
    return (await res.text()) as T;
  }

  const body = await res.json();

  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      body.message || `Request failed with status ${res.status}`,
      body.errors,
    );
  }

  return body as T;
}

// ─── API Client ─────────────────────────────────────────────────────────────

export const apiClient = {
  get<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
    let url = endpoint;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }
    return request<T>(url);
  },

  post<T>(endpoint: string, data?: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  },

  put<T>(endpoint: string, data?: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'PUT',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  },

  patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'PATCH',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  },

  delete<T>(endpoint: string, data?: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'DELETE',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  },

  upload<T>(endpoint: string, file: File, fieldName = 'file', extraFields?: Record<string, string>): Promise<T> {
    const formData = new FormData();
    formData.append(fieldName, file);
    if (extraFields) {
      Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));
    }

    // Don't set Content-Type — browser sets multipart boundary automatically.
    // Only set x-tenant-id; the HttpOnly cookie handles auth via credentials: 'include'.
    const headers: Record<string, string> = {};
    const tenantId = useAuthStore.getState().tenantId;
    if (tenantId) headers['x-tenant-id'] = tenantId;

    return request<T>(endpoint, {
      method: 'POST',
      headers,
      body: formData,
    });
  },
};
