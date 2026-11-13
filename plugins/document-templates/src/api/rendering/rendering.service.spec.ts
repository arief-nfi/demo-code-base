import { safeHttpRequestBuffer } from '@saas/backend';
import { RenderingService } from './rendering.service';

jest.mock('@saas/backend', () => {
  const actual = jest.requireActual('@saas/backend');
  return { ...actual, safeHttpRequestBuffer: jest.fn() };
});
const mockFetch = safeHttpRequestBuffer as jest.MockedFunction<typeof safeHttpRequestBuffer>;
const realFetch: typeof safeHttpRequestBuffer = jest.requireActual('@saas/backend').safeHttpRequestBuffer;

const fetched = (status: number, headers: Record<string, string>, body = Buffer.alloc(0), truncated = false) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers,
  body,
  truncated,
});

type RequestHandler = (req: FakeRequest) => Promise<void> | void;

interface FakeRequest {
  url: () => string;
  resourceType: () => string;
  continue: jest.Mock;
  abort: jest.Mock;
  respond: jest.Mock;
  isInterceptResolutionHandled: () => boolean;
}

const fakeRequest = (url: string, resourceType: string): FakeRequest => ({
  url: () => url,
  resourceType: () => resourceType,
  continue: jest.fn().mockResolvedValue(undefined),
  abort: jest.fn().mockResolvedValue(undefined),
  respond: jest.fn().mockResolvedValue(undefined),
  isInterceptResolutionHandled: () => false,
});

describe('RenderingService', () => {
  const template = {
    id: 'tpl-1',
    slug: 'invoice',
    htmlContent: '<h1>Hello {{name}}</h1><img src="{{{company.logo}}}">',
    cssContent: null,
    headerHtml: null,
    footerHtml: null,
    paperSize: 'A4',
    orientation: 'portrait',
    marginTop: '10mm',
    marginBottom: '10mm',
    marginLeft: '10mm',
    marginRight: '10mm',
  };

  const client = {
    documentTemplate: { findUnique: jest.fn() },
    documentRender: { create: jest.fn(), update: jest.fn() },
    tenant: { findFirst: jest.fn() },
    tenantConfig: { findFirst: jest.fn() },
  };
  const prisma = { getTenantClient: jest.fn(() => client) };

  let service: RenderingService;
  let page: Record<string, jest.Mock>;
  let calls: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation(realFetch);
    calls = [];
    client.documentTemplate.findUnique.mockResolvedValue(template);
    client.documentRender.create.mockResolvedValue({ id: 'render-1' });
    client.documentRender.update.mockResolvedValue({});
    client.tenant.findFirst.mockResolvedValue({ name: 'Acme' });
    client.tenantConfig.findFirst.mockResolvedValue({ logo: '/uploads/tenant_acme/config/logo.png' });

    const track = (name: string, impl?: (...args: unknown[]) => unknown) =>
      jest.fn((...args: unknown[]) => {
        calls.push(name);
        return impl ? impl(...args) : Promise.resolve();
      });
    page = {
      setJavaScriptEnabled: track('setJavaScriptEnabled'),
      setRequestInterception: track('setRequestInterception'),
      on: track('on', () => page),
      setContent: track('setContent'),
      pdf: track('pdf', () => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      close: track('close'),
    };

    service = new RenderingService(prisma as never);
    jest
      .spyOn(service as unknown as { getBrowser: () => Promise<unknown> }, 'getBrowser')
      .mockResolvedValue({ newPage: jest.fn().mockResolvedValue(page) });
  });

  const requestHandler = (): RequestHandler => {
    const call = page.on.mock.calls.find(([event]) => event === 'request');
    expect(call).toBeDefined();
    return call![1] as RequestHandler;
  };

  describe('renderPdf', () => {
    it('disables JavaScript and turns on request interception before loading the template', async () => {
      await service.renderPdf('acme', 'invoice', { name: 'World' });

      expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
      expect(page.setRequestInterception).toHaveBeenCalledWith(true);
      const contentAt = calls.indexOf('setContent');
      expect(calls.indexOf('setJavaScriptEnabled')).toBeLessThan(contentAt);
      expect(calls.indexOf('setRequestInterception')).toBeLessThan(contentAt);
      expect(calls.indexOf('on')).toBeLessThan(contentAt);
    });

    it('resolves relative /uploads/ logos against the API loopback origin', async () => {
      await service.renderPdf('acme', 'invoice', {});

      const html: string = page.setContent.mock.calls[0][0];
      expect(html).toContain(`<base href="http://127.0.0.1:${process.env.PORT || '3001'}/">`);
      expect(html).toContain('<img src="/uploads/tenant_acme/config/logo.png">');
    });

    it.each([
      ['http://169.254.169.254/latest/meta-data/', 'document'],
      ['http://127.0.0.1:59123/secret', 'image'],
      ['https://example.com/x.js', 'script'],
      ['https://example.com/api', 'fetch'],
      ['file:///etc/passwd', 'image'],
    ])('aborts %s (%s)', async (url, type) => {
      await service.renderPdf('acme', 'invoice', {});
      const req = fakeRequest(url, type);

      await requestHandler()(req);

      expect(req.abort).toHaveBeenCalled();
      expect(req.continue).not.toHaveBeenCalled();
    });

    it.each([
      ['data:image/png;base64,iVBORw0KGgo=', 'image'],
      [`http://127.0.0.1:${process.env.PORT || '3001'}/uploads/tenant_acme/config/logo.png`, 'image'],
    ])('continues %s (%s)', async (url, type) => {
      await service.renderPdf('acme', 'invoice', {});
      const req = fakeRequest(url, type);

      await requestHandler()(req);

      expect(req.continue).toHaveBeenCalled();
      expect(req.abort).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches external sub-resources through the pinned client and fulfils them (Chromium never resolves the host)', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      mockFetch.mockResolvedValue(
        fetched(200, { 'content-type': 'image/png', 'set-cookie': 'a=b', 'access-control-allow-origin': '*' }, png),
      );
      await service.renderPdf('acme', 'invoice', {});
      const req = fakeRequest('https://cdn.example.com/logo.png', 'image');

      await requestHandler()(req);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cdn.example.com/logo.png',
        expect.objectContaining({ maxResponseBytes: 5 * 1024 * 1024, timeoutMs: 10000 }),
      );
      expect(mockFetch.mock.calls[0][1]).not.toHaveProperty('allowPrivate', true);
      expect(req.respond).toHaveBeenCalledWith({
        status: 200,
        headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' },
        body: png,
      });
      expect(req.continue).not.toHaveBeenCalled();
      expect(req.abort).not.toHaveBeenCalled();
    });

    it('hands redirects back to Chromium with an absolute Location so the next hop is re-checked', async () => {
      mockFetch.mockResolvedValue(fetched(302, { location: '/next.png' }));
      await service.renderPdf('acme', 'invoice', {});
      const req = fakeRequest('https://cdn.example.com/a/logo.png', 'image');

      await requestHandler()(req);

      expect(req.respond).toHaveBeenCalledWith(
        expect.objectContaining({ status: 302, headers: { location: 'https://cdn.example.com/next.png' } }),
      );
    });

    it.each([
      ['an SSRF refusal', () => Promise.reject(Object.assign(new Error('private'), { code: 'ERR_UNSAFE_OUTBOUND_URL' }))],
      ['a DNS failure', () => Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))],
      ['a timeout', () => Promise.reject(new Error('Request timed out after 10000ms'))],
      ['an oversized body', () => Promise.resolve(fetched(200, { 'content-type': 'image/png' }, Buffer.alloc(8), true))],
    ])('aborts on %s', async (_label, outcome) => {
      mockFetch.mockImplementation(outcome as never);
      await service.renderPdf('acme', 'invoice', {});
      const req = fakeRequest('https://cdn.example.com/logo.png', 'image');

      await requestHandler()(req);

      expect(req.abort).toHaveBeenCalled();
      expect(req.respond).not.toHaveBeenCalled();
      expect(req.continue).not.toHaveBeenCalled();
    });

    it('does not throw if the page is gone when the request is resolved', async () => {
      await service.renderPdf('acme', 'invoice', {});
      const req = fakeRequest('http://169.254.169.254/', 'document');
      req.abort.mockRejectedValue(new Error('Target closed'));

      await expect(requestHandler()(req)).resolves.toBeUndefined();
    });
  });

  describe('compileTemplate', () => {
    it('emits a Content-Security-Policy that forbids scripts (HTML preview / render output)', () => {
      const html = service.compileTemplate('<p>{{x}}</p>', null, null, null, { x: 1 });

      expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'none'/);
      // The CSP must come before any template-controlled markup (e.g. CSS that closes </style>).
      expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'));
    });

    it('keeps template markup as authored and escapes {{ }} values', () => {
      const html = service.compileTemplate('<h1>Hello {{name}}</h1>', null, null, null, { name: 'R&D <Team>' });

      expect(html).toContain('<h1>Hello R&amp;D &lt;Team&gt;</h1>');
    });
  });
});
