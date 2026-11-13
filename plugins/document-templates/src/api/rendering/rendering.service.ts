import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService, registerFormattingHelpers, safeHttpRequestBuffer, type SafeHttpBufferResponse } from '@saas/backend';
import Handlebars from 'handlebars';
import { classifyRenderRequest, getApiLoopbackOrigin, getTrustedAssetPrefixes } from './render-request-policy';

let puppeteer: typeof import('puppeteer') | null = null;
type Browser = import('puppeteer').Browser;
type HTTPRequest = import('puppeteer').HTTPRequest;

/**
 * Template HTML is tenant-controlled and stored as authored. This CSP goes
 * into every compiled document (PDF, HTML render, preview opened by the web
 * editor) before any template markup, so injected scripts, plugins and frames
 * never run — wherever the HTML ends up being displayed.
 */
const TEMPLATE_CSP = "script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'";

/** Limits for template sub-resources (images, fonts, ...) fetched on Chromium's behalf. */
const SUBRESOURCE_MAX_BYTES = 5 * 1024 * 1024;
const SUBRESOURCE_TIMEOUT_MS = 10_000;

/**
 * Converts a pinned-client response into a Puppeteer fulfilment. Only the
 * headers Chromium needs are passed on; a 3xx keeps its (absolutised)
 * Location so Chromium issues the next hop, which is intercepted again.
 */
function toInterceptResponse(requestUrl: string, response: SafeHttpBufferResponse) {
  const headers: Record<string, string> = {};
  const contentType = response.headers['content-type'];
  if (contentType) headers['content-type'] = contentType;
  // Web fonts are CORS-checked by Chromium.
  const allowOrigin = response.headers['access-control-allow-origin'];
  if (typeof allowOrigin === 'string') headers['access-control-allow-origin'] = allowOrigin;
  const location = response.headers.location;
  if (response.status >= 300 && response.status < 400 && location) {
    headers.location = new URL(location, requestUrl).href;
  }
  return { status: response.status, headers, body: response.body };
}

@Injectable()
export class RenderingService implements OnModuleDestroy {
  private readonly logger = new Logger(RenderingService.name);
  private browser: Browser | null = null;
  private browserLaunching: Promise<Browser> | null = null;

  constructor(private prisma: PrismaService) {
    registerFormattingHelpers(Handlebars);
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) {
      return this.browser;
    }

    if (this.browserLaunching) {
      return this.browserLaunching;
    }

    this.browserLaunching = (async () => {
      try {
        if (!puppeteer) {
          puppeteer = await import('puppeteer');
        }
        this.browser = await puppeteer.launch({
          headless: true,
          // --no-sandbox is required because the API container runs as root.
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        });
        this.logger.log('Puppeteer browser launched');
        return this.browser;
      } finally {
        this.browserLaunching = null;
      }
    })();

    return this.browserLaunching;
  }

  compileTemplate(
    htmlContent: string,
    cssContent: string | null,
    headerHtml: string | null,
    footerHtml: string | null,
    data: Record<string, unknown>,
    baseHref?: string,
  ): string {
    const compiled = Handlebars.compile(htmlContent);
    const body = compiled(data);

    const headerCompiled = headerHtml ? Handlebars.compile(headerHtml)(data) : '';
    const footerCompiled = footerHtml ? Handlebars.compile(footerHtml)(data) : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${TEMPLATE_CSP}">
  ${baseHref ? `<base href="${baseHref.replace(/"/g, '&quot;')}">` : ''}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #333; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; }
    ${cssContent || ''}
  </style>
</head>
<body>
  ${headerCompiled ? `<header>${headerCompiled}</header>` : ''}
  <main>${body}</main>
  ${footerCompiled ? `<footer>${footerCompiled}</footer>` : ''}
</body>
</html>`;
  }

  async renderHtml(
    tenantSlug: string,
    templateSlug: string,
    data: Record<string, unknown>,
  ): Promise<{ html: string; templateId: string }> {
    const client = this.prisma.getTenantClient(tenantSlug);
    const template = await client.documentTemplate.findUnique({
      where: { slug: templateSlug },
    });

    if (!template) {
      throw new Error(`Template '${templateSlug}' not found`);
    }

    const tenantContext = await this.getTenantContext(tenantSlug);
    const mergedData = { ...tenantContext, ...data };

    const html = this.compileTemplate(
      template.htmlContent,
      template.cssContent,
      template.headerHtml,
      template.footerHtml,
      mergedData,
    );

    return { html, templateId: template.id };
  }

  async renderPdf(
    tenantSlug: string,
    templateSlug: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<{ buffer: Buffer; templateId: string; renderId: string }> {
    const client = this.prisma.getTenantClient(tenantSlug);
    const template = await client.documentTemplate.findUnique({
      where: { slug: templateSlug },
    });

    if (!template) {
      throw new Error(`Template '${templateSlug}' not found`);
    }

    const render = await client.documentRender.create({
      data: {
        templateId: template.id,
        outputFormat: 'pdf',
        status: 'rendering',
        createdBy: userId,
      },
    });

    try {
      const tenantContext = await this.getTenantContext(tenantSlug);
      const mergedData = { ...tenantContext, ...data };

      // Relative URLs (tenant logos are stored as `/uploads/...`) resolve against
      // this API's loopback origin, which the request policy trusts for /uploads/.
      const html = this.compileTemplate(
        template.htmlContent,
        template.cssContent,
        template.headerHtml,
        template.footerHtml,
        mergedData,
        `${getApiLoopbackOrigin()}/`,
      );

      const browser = await this.getBrowser();
      const page = await browser.newPage();

      try {
        // No JavaScript, and every request is vetted by the SSRF policy;
        // external sub-resources are fetched by Node through the pinned client.
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        const trustedPrefixes = getTrustedAssetPrefixes();
        page.on('request', (request) => this.handleRenderRequest(request, trustedPrefixes));

        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
          format: template.paperSize === 'Letter' ? 'Letter' : template.paperSize === 'Legal' ? 'Legal' : 'A4',
          landscape: template.orientation === 'landscape',
          margin: {
            top: template.marginTop,
            bottom: template.marginBottom,
            left: template.marginLeft,
            right: template.marginRight,
          },
          printBackground: true,
        });

        const buffer = Buffer.from(pdfBuffer);

        await client.documentRender.update({
          where: { id: render.id },
          data: {
            status: 'completed',
            fileSize: buffer.length,
          },
        });

        return { buffer, templateId: template.id, renderId: render.id };
      } finally {
        await page.close();
      }
    } catch (error) {
      await client.documentRender.update({
        where: { id: render.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }

  private async handleRenderRequest(request: HTTPRequest, trustedPrefixes: string[]): Promise<void> {
    const url = request.url();
    const resourceType = request.resourceType();
    let reason: string;

    try {
      const action = classifyRenderRequest(url, resourceType, trustedPrefixes);
      if (action === 'continue') {
        return await request.continue();
      }
      if (action === 'abort') {
        reason = 'not allowed';
      } else {
        const response = await safeHttpRequestBuffer(url, {
          maxResponseBytes: SUBRESOURCE_MAX_BYTES,
          timeoutMs: SUBRESOURCE_TIMEOUT_MS,
        });
        if (!response.truncated) {
          return await request.respond(toInterceptResponse(url, response));
        }
        reason = `larger than ${SUBRESOURCE_MAX_BYTES} bytes`;
      }
    } catch (err) {
      reason = err instanceof Error ? err.message : 'fetch failed';
    }

    this.logger.warn(`Blocked ${resourceType} request during PDF render (${reason}): ${url.slice(0, 200)}`);
    // The page may already be closed — nothing left to resolve then.
    await request.abort('blockedbyclient').catch(() => undefined);
  }

  async previewTemplate(
    tenantSlug: string,
    templateId: string,
  ): Promise<string> {
    const client = this.prisma.getTenantClient(tenantSlug);
    const template = await client.documentTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error(`Template with ID ${templateId} not found`);
    }

    const tenantContext = await this.getTenantContext(tenantSlug);
    let sampleData: Record<string, unknown> = {};

    if (template.sampleData) {
      try {
        sampleData = JSON.parse(template.sampleData);
      } catch {
        // ignore invalid JSON
      }
    }

    const mergedData = { ...tenantContext, ...sampleData };

    return this.compileTemplate(
      template.htmlContent,
      template.cssContent,
      template.headerHtml,
      template.footerHtml,
      mergedData,
    );
  }

  private async getTenantContext(tenantSlug: string): Promise<Record<string, unknown>> {
    try {
      const client = this.prisma.getTenantClient(tenantSlug);
      const tenant = await client.tenant.findFirst();
      const config = await client.tenantConfig.findFirst();

      return {
        company: {
          name: tenant?.name || '',
          logo: config?.logo || '',
          address: config?.description || '',
          phone: '',
          email: '',
          website: config?.domain || '',
          taxId: '',
        },
        currentDate: new Date().toISOString().split('T')[0],
        currentYear: String(new Date().getFullYear()),
        currency: config?.currency || 'USD',
      };
    } catch {
      return {
        company: { name: '', logo: '', address: '', phone: '', email: '', website: '', taxId: '' },
        currentDate: new Date().toISOString().split('T')[0],
        currentYear: String(new Date().getFullYear()),
        currency: 'USD',
      };
    }
  }
}
