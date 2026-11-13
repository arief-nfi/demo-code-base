import { describe, it, expect } from 'vitest';
import { ApiNetworkError, ApiRequestError } from './api-client';
import { autoRetryDelay, classifyLoadError, describeLoadError } from './load-error';

describe('classifyLoadError', () => {
  it('a request with no response is "offline" when the browser is offline, else "unreachable"', () => {
    const err = new ApiNetworkError('Failed to fetch');
    expect(classifyLoadError(err, false)).toBe('offline');
    expect(classifyLoadError(err, true)).toBe('unreachable');
  });

  it.each([500, 502, 503, 504, 429])('HTTP %i is "unavailable"', (status) => {
    expect(classifyLoadError(new ApiRequestError(status, 'x'), true)).toBe('unavailable');
  });

  it.each([400, 403, 404, 409])('HTTP %i is "failed"', (status) => {
    expect(classifyLoadError(new ApiRequestError(status, 'x'), true)).toBe('failed');
  });

  it('any other error, such as a bug applying the session, is "failed" even while offline', () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'includes')");
    expect(classifyLoadError(bug, true)).toBe('failed');
    expect(classifyLoadError(bug, false)).toBe('failed');
  });
});

describe('describeLoadError', () => {
  it('names what failed in one line', () => {
    expect(describeLoadError(new ApiNetworkError('Failed to fetch'))).toBe('Network error: Failed to fetch');
    expect(describeLoadError(new ApiRequestError(503, 'Service Unavailable'))).toBe('HTTP 503: Service Unavailable');
    expect(describeLoadError(new TypeError('x is undefined'))).toBe('TypeError: x is undefined');
    expect(describeLoadError('boom')).toBe('boom');
  });
});

describe('autoRetryDelay', () => {
  it('doubles from 3 seconds and stops growing at 30', () => {
    expect([1, 2, 3, 4, 5, 9].map(autoRetryDelay)).toEqual([3, 6, 12, 24, 30, 30]);
  });
});
