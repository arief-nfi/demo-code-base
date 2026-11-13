import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient, ApiNetworkError } from './api-client';

describe('apiClient network failures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws ApiNetworkError when the request gets no response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const err = await apiClient.get('/auth/me').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiNetworkError);
    // Still a TypeError, like the fetch failure it stands for.
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe('Failed to fetch');
  });

  it('lets an aborted request reject with its own AbortError', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    await expect(apiClient.get('/auth/me')).rejects.toBe(abort);
  });
});
