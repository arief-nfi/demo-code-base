'use client';

import { useState, useCallback } from 'react';
import { usePaginatedApi } from './use-api';

export interface UsePaginatedListOptions {
  /** Default sort field (default: 'createdAt') */
  defaultSortBy?: string;
  /** Default sort order (default: 'desc') */
  defaultSortOrder?: 'asc' | 'desc';
  /** Default page size (default: 10) */
  defaultLimit?: number;
  /** Search debounce in ms (default: 500) */
  searchDebounceMs?: number;
  /** Skip fetching (e.g. while RBAC is loading) */
  skip?: boolean;
}

export function usePaginatedList<T extends { id: string }>(
  endpoint: string,
  options: UsePaginatedListOptions = {},
) {
  const {
    defaultSortBy = 'createdAt',
    defaultSortOrder = 'desc',
    defaultLimit = 10,
    searchDebounceMs = 500,
    skip = false,
  } = options;

  // Search, sort, pagination state
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState(defaultSortBy);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(defaultSortOrder);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(defaultLimit);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Data fetching
  const { data, meta, loading, error, refetch } = usePaginatedApi<T>(endpoint, {
    page,
    limit,
    search,
    sortBy,
    sortOrder,
    skip,
    debounce: searchDebounceMs,
  });

  // Sort handler — toggles order on same field, resets to asc on new field
  const handleSort = useCallback(
    (field: string) => {
      if (sortBy === field) {
        setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(field);
        setSortOrder('asc');
      }
      setPage(1);
    },
    [sortBy],
  );

  // Search handler — resets to page 1
  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  // Selection handlers
  const toggleSelection = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(data.map((item) => item.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [data],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    // Data
    data,
    meta,
    loading,
    error,
    refetch,

    // Search
    search,
    setSearch: handleSearch,

    // Sort
    sortBy,
    sortOrder,
    handleSort,

    // Pagination
    page,
    setPage,
    limit,
    setLimit,

    // Selection
    selectedIds,
    toggleSelection,
    selectAll,
    clearSelection,
  };
}
