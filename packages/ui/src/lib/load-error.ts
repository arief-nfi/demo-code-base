import { ApiNetworkError, ApiRequestError } from './api-client';

/**
 * How a load failed, as far as the person waiting is concerned:
 * - `offline`: the browser has no connection;
 * - `unreachable`: no response from the API (down, restarting, blocked);
 * - `unavailable`: the API answered with a server error or "too many requests";
 * - `failed`: anything else. Retrying on its own won't fix it.
 */
export type LoadErrorKind = 'offline' | 'unreachable' | 'unavailable' | 'failed';

export function classifyLoadError(
  error: unknown,
  online: boolean = typeof navigator === 'undefined' || navigator.onLine,
): LoadErrorKind {
  if (error instanceof ApiNetworkError) return online ? 'unreachable' : 'offline';
  if (error instanceof ApiRequestError && (error.statusCode >= 500 || error.statusCode === 429)) {
    return 'unavailable';
  }
  return 'failed';
}

/** One line naming what failed, for support details. */
export function describeLoadError(error: unknown): string {
  if (error instanceof ApiNetworkError) return `Network error: ${error.message}`;
  if (error instanceof ApiRequestError) return `HTTP ${error.statusCode}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Seconds to wait before retrying on its own after `failures` failed attempts in a row. */
export function autoRetryDelay(failures: number): number {
  return Math.min(30, 3 * 2 ** Math.max(0, failures - 1));
}
