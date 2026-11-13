import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiNetworkError, ApiRequestError } from '../lib/api-client';
import { useAutoRetry } from './use-auto-retry';

const network = new ApiNetworkError('Failed to fetch');

describe('useAutoRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('counts down and retries a failure that can clear up on its own', () => {
    const retry = vi.fn();
    const { result } = renderHook(() => useAutoRetry({ error: network, retrying: false, failures: 1, retry }));

    expect(result.current).toEqual({ kind: 'unreachable', delay: 3, secondsLeft: 3 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.secondsLeft).toBe(2);
    act(() => vi.advanceTimersByTime(2000));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('waits longer after each failure in a row', () => {
    const { result } = renderHook(() =>
      useAutoRetry({ error: new ApiRequestError(503, 'Service Unavailable'), retrying: false, failures: 3, retry: vi.fn() }),
    );
    expect(result.current).toEqual({ kind: 'unavailable', delay: 12, secondsLeft: 12 });
  });

  it('does not retry a failure that retrying cannot fix', () => {
    const retry = vi.fn();
    const { result } = renderHook(() =>
      useAutoRetry({ error: new ApiRequestError(403, 'Forbidden'), retrying: false, failures: 1, retry }),
    );

    expect(result.current).toEqual({ kind: 'failed', delay: null, secondsLeft: null });
    act(() => {
      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event('online'));
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it('does not count down while a retry is running', () => {
    const retry = vi.fn();
    const { result } = renderHook(() => useAutoRetry({ error: network, retrying: true, failures: 1, retry }));

    expect(result.current.secondsLeft).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries at once when the browser comes back online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const retry = vi.fn();
    const { result } = renderHook(() => useAutoRetry({ error: network, retrying: false, failures: 1, retry }));
    expect(result.current.kind).toBe('offline');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('stops once unmounted', () => {
    const retry = vi.fn();
    const { unmount } = renderHook(() => useAutoRetry({ error: network, retrying: false, failures: 1, retry }));

    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event('online'));
    });
    expect(retry).not.toHaveBeenCalled();
  });
});
