import * as http from 'http';
import * as https from 'https';
import { assertSafeOutboundUrl, createSafeLookup, type OutboundUrlOptions } from './outbound-url';

export interface SafeHttpRequestOptions extends OutboundUrlOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Total time budget for connect + response, in ms. Default 10s. */
  timeoutMs?: number;
  /**
   * Stop reading the response body after this many bytes (`truncated` is set).
   * Default 64 KiB for `safeHttpRequest`, 5 MiB for `safeHttpRequestBuffer`.
   */
  maxResponseBytes?: number;
}

export interface SafeHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** True when the body was cut off at `maxResponseBytes`. */
  truncated: boolean;
}

export interface SafeHttpBufferResponse extends Omit<SafeHttpResponse, 'body'> {
  body: Buffer;
}

/**
 * SSRF-safe outbound HTTP request for user-configured URLs (webhooks etc.),
 * returning the body as UTF-8 text (capped at 64 KiB by default).
 * See `safeHttpRequestBuffer` for the guarantees.
 */
export async function safeHttpRequest(rawUrl: string, options: SafeHttpRequestOptions = {}): Promise<SafeHttpResponse> {
  const response = await safeHttpRequestBuffer(rawUrl, {
    ...options,
    maxResponseBytes: options.maxResponseBytes ?? 64 * 1024,
  });
  return { ...response, body: response.body.toString('utf8') };
}

/**
 * SSRF-safe outbound HTTP request returning the raw body bytes (images, fonts),
 * capped at 5 MiB by default.
 *
 * - Validates the URL with `assertSafeOutboundUrl()` (rejects with `UnsafeOutboundUrlError`).
 * - Connects through `createSafeLookup()`, so the socket only ever connects to
 *   addresses that were validated at connect time (DNS-rebinding safe), on a
 *   fresh connection (`agent: false`) that is never shared with other requests.
 * - Never follows redirects — a 3xx is returned to the caller as-is.
 * - Enforces a total timeout and a response-size cap.
 */
export async function safeHttpRequestBuffer(
  rawUrl: string,
  options: SafeHttpRequestOptions = {},
): Promise<SafeHttpBufferResponse> {
  const url = await assertSafeOutboundUrl(rawUrl, options);
  const { method = 'GET', headers = {}, body, timeoutMs = 10_000, maxResponseBytes = 5 * 1024 * 1024 } = options;
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<SafeHttpBufferResponse>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const req = transport.request(
      url,
      {
        method,
        headers: body !== undefined ? { 'Content-Length': String(Buffer.byteLength(body)), ...headers } : headers,
        agent: false,
        lookup: createSafeLookup(options),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;

        const finish = () =>
          settle(() =>
            resolve({
              ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              headers: res.headers,
              body: Buffer.concat(chunks),
              truncated,
            }),
          );

        res.on('data', (chunk: Buffer) => {
          const remaining = maxResponseBytes - received;
          chunks.push(chunk.subarray(0, remaining));
          received += Math.min(chunk.length, remaining);
          if (chunk.length > remaining) {
            truncated = true;
            finish();
            res.destroy();
          }
        });
        res.on('end', finish);
        res.on('error', (err) => settle(() => reject(err)));
      },
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on('error', (err) => settle(() => reject(err)));

    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}
