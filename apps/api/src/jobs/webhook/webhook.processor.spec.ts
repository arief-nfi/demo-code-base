import * as http from 'http';
import type { AddressInfo } from 'net';
import { Job, UnrecoverableError } from 'bullmq';
import { safeHttpRequest } from '@saas/backend';
import { WebhookProcessor } from './webhook.processor';
import type { WebhookJobData } from './webhook.producer';

// Wrap (not replace) the SSRF-safe client so individual tests can stub it.
jest.mock('@saas/backend', () => {
  const actual = jest.requireActual('@saas/backend');
  return { ...actual, safeHttpRequest: jest.fn(actual.safeHttpRequest) };
});
const mockSafeHttpRequest = safeHttpRequest as jest.MockedFunction<typeof safeHttpRequest>;
const realSafeHttpRequest: typeof safeHttpRequest = jest.requireActual('@saas/backend').safeHttpRequest;

describe('WebhookProcessor', () => {
  let server: http.Server;
  let port: number;
  let hits: Array<{ url?: string; method?: string; signature?: string; body: string }>;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let processor: WebhookProcessor;

  const job = (webhookUrl: string) =>
    ({
      id: 'job-1',
      attemptsMade: 0,
      data: {
        tenantSlug: 'acme',
        webhookId: 'wh-1',
        webhookUrl,
        webhookSecret: 'secret',
        eventType: 'order.created',
        payload: { orderId: '123' },
      },
    }) as unknown as Job<WebhookJobData>;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        hits.push({
          url: req.url,
          method: req.method,
          signature: req.headers['x-webhook-signature'] as string | undefined,
          body,
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
    handler = (_req, res) => res.end('internal-only response');
    mockSafeHttpRequest.mockReset();
    mockSafeHttpRequest.mockImplementation(realSafeHttpRequest);
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
    processor = new WebhookProcessor();
  });

  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  });

  it('refuses to POST to an internal address and fails the job without retries', async () => {
    const err = await processor.process(job(`http://127.0.0.1:${port}/`)).catch((e) => e);

    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(err.message).toMatch(/^Blocked by SSRF protection: .*private or reserved/);
    expect(hits).toEqual([]);
  });

  it('matches policy errors by code (a second copy of @saas/backend is still unrecoverable)', async () => {
    mockSafeHttpRequest.mockRejectedValue(
      Object.assign(new Error('Host hooks.example.com resolves to private or reserved address 10.0.0.7'), {
        code: 'ERR_UNSAFE_OUTBOUND_URL',
      }),
    );

    await expect(processor.process(job('https://hooks.example.com/'))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('sends through the SSRF-safe client with private targets disallowed by default', async () => {
    mockSafeHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '',
      truncated: false,
    });

    await expect(processor.process(job('https://hooks.example.com/'))).resolves.toEqual(
      expect.objectContaining({ statusCode: 200 }),
    );
    expect(mockSafeHttpRequest).toHaveBeenCalledWith(
      'https://hooks.example.com/',
      expect.objectContaining({ method: 'POST', allowPrivate: false, timeoutMs: 10000 }),
    );
  });

  describe('with ALLOW_PRIVATE_WEBHOOK_URLS=true (local development)', () => {
    beforeEach(() => {
      process.env.ALLOW_PRIVATE_WEBHOOK_URLS = 'true';
    });

    it('delivers the signed payload', async () => {
      const result = await processor.process(job(`http://127.0.0.1:${port}/hook`));

      expect(result.statusCode).toBe(200);
      expect(hits).toEqual([
        expect.objectContaining({
          url: '/hook',
          method: 'POST',
          body: JSON.stringify({ orderId: '123' }),
          signature: expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
        }),
      ]);
    });

    it('does not follow redirects (retryable failure with the 3xx recorded)', async () => {
      handler = (req, res) => {
        if (req.url === '/start') {
          res.writeHead(302, 'Found', { Location: `http://127.0.0.1:${port}/elsewhere` });
          res.end();
          return;
        }
        res.end('followed');
      };

      const err = await processor.process(job(`http://127.0.0.1:${port}/start`)).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(UnrecoverableError);
      expect(err.message).toBe('HTTP 302: Found (redirects are not followed)');
      expect(hits.map((h) => h.url)).toEqual(['/start']);
    });
  });
});
