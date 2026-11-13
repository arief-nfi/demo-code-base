import { execFileSync } from 'child_process';
import * as dns from 'dns';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { safeHttpRequestBuffer } from '@saas/backend';
import { RenderingService } from './rendering.service';

// Wrap (not replace) the pinned client so a test can pretend a host is public.
jest.mock('@saas/backend', () => {
  const actual = jest.requireActual('@saas/backend');
  return { ...actual, safeHttpRequestBuffer: jest.fn(actual.safeHttpRequestBuffer) };
});
const mockFetch = safeHttpRequestBuffer as jest.MockedFunction<typeof safeHttpRequestBuffer>;
const realFetch: typeof safeHttpRequestBuffer = jest.requireActual('@saas/backend').safeHttpRequestBuffer;

/**
 * End-to-end check with a real headless Chromium: template HTML pointing at an
 * internal-only HTTP service must not get that service's content into the PDF,
 * while the tenant logo served from the API's own /uploads/ still renders.
 * Skipped automatically when Puppeteer's Chromium is not installed.
 */

const SECRET = 'TOP-SECRET-INTERNAL-7f3a9c';
// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function chromiumInstalled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteer = require('puppeteer');
    return fs.existsSync(puppeteer.executablePath());
  } catch {
    return false;
  }
}

function pdfToText(buffer: Buffer): string | null {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
  } catch {
    return null; // pdftotext not installed — the request log assertions still apply
  }
  return execFileSync('pdftotext', ['-', '-'], { input: buffer }).toString('utf8');
}

(chromiumInstalled() ? describe : describe.skip)('RenderingService PDF rendering — SSRF (real Chromium)', () => {
  jest.setTimeout(60_000);

  let server: http.Server;
  let port: number;
  let hits: string[];
  let service: RenderingService;
  const originalPort = process.env.PORT;

  const template = {
    id: 'tpl-1',
    slug: 'invoice',
    htmlContent: '',
    cssContent: null as string | null,
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
    documentTemplate: { findUnique: jest.fn(async () => template) },
    documentRender: { create: jest.fn(async () => ({ id: 'render-1' })), update: jest.fn(async () => ({})) },
    tenant: { findFirst: jest.fn(async () => ({ name: 'Acme' })) },
    tenantConfig: { findFirst: jest.fn(async () => ({ logo: '/uploads/tenant_acme/config/logo.png' })) },
  };

  beforeAll(async () => {
    // Plays both roles: an internal-only service holding a secret, and this
    // API serving its own /uploads/ (PORT points at it, as in production).
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url?.startsWith('/uploads/') || req.url === '/pixel.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
        return;
      }
      if (req.url === '/redirect-to-internal') {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/internal-secret.png` });
        res.end();
        return;
      }
      if (req.url?.endsWith('.css')) {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(`main::after { content: "${SECRET}"; }`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>${SECRET}</h1></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    process.env.PORT = String(port);

    service = new RenderingService({ getTenantClient: () => client } as never);
  });

  afterAll(async () => {
    await service?.onModuleDestroy();
    await new Promise((resolve) => server.close(resolve));
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  beforeEach(() => {
    hits = [];
    mockFetch.mockImplementation(realFetch);
  });

  it('does not fetch internal URLs (iframe, img, css, object, script) but still renders the /uploads/ logo', async () => {
    const internal = `http://127.0.0.1:${port}`;
    template.htmlContent = `
      <p>visible-marker</p>
      {{#if company.logo}}<img src="{{{company.logo}}}" alt="logo">{{/if}}
      <iframe src="${internal}/iframe-secret" width="600" height="200"></iframe>
      <img src="${internal}/img-secret.png">
      <img src="http://169.254.169.254/latest/meta-data/">
      <link rel="stylesheet" href="${internal}/style.css">
      <object data="${internal}/object-secret" width="300" height="100"></object>
      <script>
        fetch('${internal}/fetch-secret');
        document.write('<p>script-ran</p>');
      </script>
    `;
    template.cssContent = `@import url("${internal}/import.css");`;

    const { buffer } = await service.renderPdf('acme', 'invoice', {});

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(hits.filter((url) => !url.startsWith('/uploads/'))).toEqual([]);
    expect(hits).toContain('/uploads/tenant_acme/config/logo.png');

    const text = pdfToText(buffer);
    if (text !== null) {
      expect(text).toContain('visible-marker');
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('script-ran');
    }
  });

  it('is not fooled by DNS rebinding: Chromium never resolves template hosts itself', async () => {
    // Node's resolver first says rebind.test is public, then flips to loopback;
    // Chromium's resolver maps it straight onto the internal server.
    const realLookup = dns.promises.lookup.bind(dns.promises) as (...args: unknown[]) => Promise<unknown>;
    let answers = 0;
    const lookupSpy = jest.spyOn(dns.promises, 'lookup').mockImplementation(((host: string, options: unknown) =>
      host === 'rebind.test'
        ? Promise.resolve([{ address: answers++ === 0 ? '93.184.216.34' : '127.0.0.1', family: 4 }])
        : realLookup(host, options)) as never);
    const puppeteer = await import('puppeteer');
    const rebindingBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--host-resolver-rules=MAP rebind.test 127.0.0.1'],
    });
    jest
      .spyOn(service as unknown as { getBrowser: () => Promise<unknown> }, 'getBrowser')
      .mockResolvedValueOnce(rebindingBrowser);

    try {
      template.htmlContent = `<p>visible-marker</p><img src="http://rebind.test:${port}/rebind-secret.png">`;
      template.cssContent = null;

      const { buffer } = await service.renderPdf('acme', 'invoice', {});

      expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
      expect(hits).toEqual([]);
    } finally {
      lookupSpy.mockRestore();
      await rebindingBrowser.close();
    }
  });

  it('re-checks every redirect hop: a public URL that 302s to an internal address never reaches it', async () => {
    const internal = `http://127.0.0.1:${port}`;
    // Test seam: treat public.example as a public host served by the local server.
    // Every other URL (including the redirect target) goes through the real pinned client.
    mockFetch.mockImplementation((url, options) => {
      const target = new URL(url);
      return target.hostname === 'public.example'
        ? realFetch(`${internal}${target.pathname}`, { ...options, allowPrivate: true })
        : realFetch(url, options);
    });
    template.htmlContent = `
      <p>visible-marker</p>
      <img src="http://public.example:${port}/pixel.png">
      <img src="http://public.example:${port}/redirect-to-internal">
    `;
    template.cssContent = null;

    const { buffer } = await service.renderPdf('acme', 'invoice', {});

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(hits).toContain('/pixel.png'); // public image fetched by Node and handed to Chromium
    expect(hits).toContain('/redirect-to-internal'); // first hop
    // Chromium followed the 302; the next hop was intercepted and re-checked by the policy...
    expect(mockFetch).toHaveBeenCalledWith(`${internal}/internal-secret.png`, expect.anything());
    // ...and refused by the pinned client, so the internal server was never reached.
    expect(hits).not.toContain('/internal-secret.png');
  });

  it('compiled HTML written into a JS-enabled window (web editor "full preview") cannot run scripts', async () => {
    const html = service.compileTemplate(
      `<p>preview</p>
       <script>window.__pwned = 'script'</script>
       <img src="data:," onerror="window.__pwned = 'handler'">
       <a id="js" href="javascript:window.__pwned = 'link'">x</a>`,
      `</style><script>window.__pwned = 'css-breakout'</script><style>`,
      null,
      null,
      {},
    );

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      // Same mechanism as template-editor.tsx: document.write into a script-enabled window.
      await page.evaluate((doc) => {
        document.open();
        document.write(doc);
        document.close();
      }, html);
      const pwned = () => page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await pwned()).toBeUndefined(); // inline <script>, onerror handler, </style> breakout

      await page.evaluate(() => (document.getElementById('js') as HTMLAnchorElement | null)?.click());
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await page.evaluate(() => document.body?.textContent ?? '')).toContain('preview'); // javascript: URL
    } finally {
      await browser.close();
    }
  });
});
