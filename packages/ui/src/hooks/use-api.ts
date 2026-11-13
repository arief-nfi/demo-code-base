'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, ApiRequestError } from '../lib/api-client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UseApiOptions {
  /** Skip the initial fetch (useful when waiting for RBAC or other conditions) */
  skip?: boolean;
  /** Debounce delay in ms for parameter changes (default: 0) */
  debounce?: number;
}

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// ─── Paginated Types ────────────────────────────────────────────────────────

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedData<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface UsePaginatedApiOptions extends UseApiOptions {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface UsePaginatedApiResult<T> {
  data: T[];
  meta: PaginationMeta;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// ─── useApi Hook ────────────────────────────────────────────────────────────

export function useApi<T>(
  endpoint: string | null,
  params?: Record<string, string | number | undefined>,
  options?: UseApiOptions,
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const skip = options?.skip ?? false;
  const debounceMs = options?.debounce ?? 0;

  // Stable serialization of params for dependency tracking
  const paramsKey = params ? JSON.stringify(params) : '';

  const fetchData = useCallback(async () => {
    if (skip || !endpoint) {
      setLoading(false);
      return;
    }

    // Abort previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await apiClient.get<T>(endpoint, params);
      if (!controller.signal.aborted) {
        setData(result);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err instanceof ApiRequestError) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred');
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [endpoint, paramsKey, skip]);

  useEffect(() => {
    if (debounceMs > 0) {
      const timer = setTimeout(fetchData, debounceMs);
      return () => clearTimeout(timer);
    }
    fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData, debounceMs]);

  return { data, loading, error, refetch: fetchData };
}

// ─── usePaginatedApi Hook ───────────────────────────────────────────────────

export function usePaginatedApi<T>(
  endpoint: string | null,
  options?: UsePaginatedApiOptions,
): UsePaginatedApiResult<T> {
  const {
    page = 1,
    limit = 10,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    skip,
    debounce,
  } = options || {};

  const params: Record<string, string | number | undefined> = {
    page,
    limit,
    sortBy,
    sortOrder,
    search: search || undefined,
  };

  const { data, loading, error, refetch } = useApi<PaginatedData<T>>(
    endpoint,
    params,
    { skip, debounce },
  );

  return {
    data: data?.data ?? [],
    meta: data?.meta ?? { total: 0, page, limit, totalPages: 0 },
    loading,
    error,
    refetch,
  };
}
