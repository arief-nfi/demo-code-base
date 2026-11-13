import * as dns from 'dns';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { UnsafeOutboundUrlError } from './outbound-url';
import { safeHttpRequest, safeHttpRequestBuffer } from './safe-http-request';

describe('safeHttpRequest', () => {
  let server: http.Server;
  let port: number;
  let hits: Array<{ method?: string; url?: string; host?: string; body: string; contentLength?: string }>;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        hits.push({
          method: req.method,
          url: req.url,
          host: req.headers.host,
          body,
          contentLength: req.headers['content-length'],
        });
        handler(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    hits = [];
    handler = (_req, res) => res.end('internal secret');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refuses a literal private address without connecting', async () => {
    await expect(safeHttpRequest(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' })).rejects.toThrow(
      UnsafeOutboundUrlError,
    );
    expect(hits).toHaveLength(0);
  });

  it('safeHttpRequestBuffer refuses a literal private address without connecting', async () => {
    await expect(safeHttpRequestBuffer(`http://127.0.0.1:${port}/logo.png`)).rejects.toThrow(UnsafeOutboundUrlError);
    expect(hits).toHaveLength(0);
  });

  it('refuses a hostname that resolves to loopback without connecting', async () => {
    await expect(safeHttpRequest(`http://localhost:${port}/`)).rejects.toThrow(UnsafeOutboundUrlError);
    expect(hits).toHaveLength(0);
  });

  it('re-validates at connect time so a DNS rebind to a private address is refused', async () => {
    const lookupSpy = jest.spyOn(dns.promises, 'lookup') as jest.SpyInstance;
    lookupSpy
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // pre-flight check: public
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]); // at connect: rebinds to loopback

    await expect(safeHttpRequest(`http://rebind.example:${port}/`)).rejects.toThrow(UnsafeOutboundUrlError);
    expect(lookupSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(hits).toHaveLength(0);
  });

  it('connects to the address returned by the validating resolver (pinning)', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);

    const res = await safeHttpRequest(`http://pinned.example:${port}/path`, { allowPrivate: true });

    expect(res.status).toBe(200);
    expect(hits).toEqual([expect.objectContaining({ host: `pinned.example:${port}`, url: '/path' })]);
  });

  describe('with allowPrivate (local development)', () => {
    it('sends method, headers and body, and returns status and body', async () => {
      handler = (req, res) => {
        res.writeHead(201, 'Created', { 'X-Echo': String(req.headers['x-test']) });
        res.end('created');
      };

      const res = await safeHttpRequest(`http://127.0.0.1:${port}/hook`, {
        allowPrivate: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' },
        body: '{"a":"ü"}',
      });

      expect(res).toEqual(
        expect.objectContaining({ ok: true, status: 201, statusText: 'Created', body: 'created', truncated: false }),
      );
      expect(res.headers['x-echo']).toBe('yes');
      expect(hits[0]).toEqual(
        expect.objectContaining({ method: 'POST', body: '{"a":"ü"}', contentLength: String(Buffer.byteLength('{"a":"ü"}')) }),
      );
    });

    it('does not follow redirects', async () => {
      handler = (req, res) => {
        if (req.url === '/start') {
          res.writeHead(302, 'Found', { Location: `http://127.0.0.1:${port}/secret` });
          res.end();
          return;
        }
        res.end('secret');
      };

      const res = await safeHttpRequest(`http://127.0.0.1:${port}/start`, { allowPrivate: true });

      expect(res.status).toBe(302);
      expect(res.ok).toBe(false);
      expect(res.headers.location).toBe(`http://127.0.0.1:${port}/secret`);
      expect(hits.map((h) => h.url)).toEqual(['/start']);
    });

    it('caps the response body at maxResponseBytes', async () => {
      handler = (_req, res) => res.end('x'.repeat(100_000));

      const res = await safeHttpRequest(`http://127.0.0.1:${port}/big`, { allowPrivate: true, maxResponseBytes: 1000 });

      expect(res.body).toHaveLength(1000);
      expect(res.truncated).toBe(true);
    });

    it('safeHttpRequestBuffer returns the raw bytes and headers', async () => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80]); // not valid UTF-8
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(bytes);
      };

      const res = await safeHttpRequestBuffer(`http://127.0.0.1:${port}/logo.png`, { allowPrivate: true });

      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.equals(bytes)).toBe(true);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.truncated).toBe(false);
    });

    it('safeHttpRequestBuffer caps at 5 MiB by default (image-sized), flagging truncation', async () => {
      handler = (_req, res) => res.end(Buffer.alloc(6 * 1024 * 1024, 1));

      const res = await safeHttpRequestBuffer(`http://127.0.0.1:${port}/huge`, { allowPrivate: true });

      expect(res.body.length).toBe(5 * 1024 * 1024);
      expect(res.truncated).toBe(true);
    });

    it('safeHttpRequestBuffer does not follow redirects either', async () => {
      handler = (req, res) => {
        if (req.url === '/img') {
          res.writeHead(302, { Location: `http://127.0.0.1:${port}/secret.png` });
          res.end();
          return;
        }
        res.end('secret');
      };

      const res = await safeHttpRequestBuffer(`http://127.0.0.1:${port}/img`, { allowPrivate: true });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`http://127.0.0.1:${port}/secret.png`);
      expect(hits.map((h) => h.url)).toEqual(['/img']);
    });

    it('safeHttpRequest keeps its 64 KiB default cap', async () => {
      handler = (_req, res) => res.end('y'.repeat(100 * 1024));

      const res = await safeHttpRequest(`http://127.0.0.1:${port}/text`, { allowPrivate: true });

      expect(res.body).toHaveLength(64 * 1024);
      expect(res.truncated).toBe(true);
    });

    it('times out when the server does not respond', async () => {
      handler = () => {
        /* never respond */
      };

      await expect(
        safeHttpRequest(`http://127.0.0.1:${port}/slow`, { allowPrivate: true, timeoutMs: 200 }),
      ).rejects.toThrow(/timed out after 200ms/);
    });
  });
});
