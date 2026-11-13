import { classifyRenderRequest, getTrustedAssetPrefixes } from './render-request-policy';

describe('classifyRenderRequest', () => {
  const trusted = ['http://127.0.0.1:3001/uploads/'];

  describe('inline schemes', () => {
    it.each([
      ['data:image/png;base64,iVBORw0KGgo=', 'image'],
      ['data:text/html,<p>hi</p>', 'document'],
      ['blob:http://localhost/1234', 'image'],
      ['about:blank', 'document'],
    ])('lets Chromium handle %s (%s)', (url, type) => {
      expect(classifyRenderRequest(url, type, trusted)).toBe('continue');
    });
  });

  describe('other schemes', () => {
    it.each([
      'file:///etc/passwd',
      'ftp://example.com/x.png',
      'ws://example.com/socket',
      'chrome://settings',
      'javascript:alert(1)',
      'not a url',
    ])('aborts %s', (url) => {
      expect(classifyRenderRequest(url, 'image', trusted)).toBe('abort');
    });
  });

  describe('external http(s)', () => {
    it.each(['image', 'stylesheet', 'font', 'media'])(
      'fetches passive resource type %s through the pinned client (never via Chromium)',
      (type) => {
        expect(classifyRenderRequest('https://cdn.example.com/a', type, trusted)).toBe('fetch');
      },
    );

    it.each([
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://127.0.0.1:59123/secret.png',
      'http://internal.corp/logo.png',
    ])('routes %s to the pinned client too, which performs the address check', (url) => {
      expect(classifyRenderRequest(url, 'image', trusted)).toBe('fetch');
    });

    it.each([
      'document',
      'xhr',
      'fetch',
      'script',
      'websocket',
      'eventsource',
      'other',
      'ping',
      'prefetch',
      'manifest',
      'texttrack',
    ])('aborts resource type %s', (type) => {
      expect(classifyRenderRequest('https://cdn.example.com/a', type, trusted)).toBe('abort');
    });
  });

  describe("trusted asset prefix (the API's own /uploads/ on loopback)", () => {
    it.each(['image', 'stylesheet', 'font', 'media'])('lets Chromium load %s under the prefix directly', (type) => {
      expect(classifyRenderRequest('http://127.0.0.1:3001/uploads/tenant_acme/config/logo.png', type, trusted)).toBe(
        'continue',
      );
    });

    it.each([
      ['document', 'http://127.0.0.1:3001/uploads/a.html'],
      ['xhr', 'http://127.0.0.1:3001/uploads/a.json'],
      ['script', 'http://127.0.0.1:3001/uploads/a.js'],
    ])('still aborts %s under the prefix', (type, url) => {
      expect(classifyRenderRequest(url, type, trusted)).toBe('abort');
    });

    it.each([
      'http://127.0.0.1:3001/auth/me',
      'http://127.0.0.1:3001/uploadsX/logo.png',
      'http://127.0.0.1:3001/uploads/../auth/me', // normalised to /auth/me
      'http://127.0.0.1:3001/uploads/%2e%2e/auth/me', // normalised to /auth/me
      'http://127.0.0.1:3002/uploads/logo.png',
      'https://127.0.0.1:3001/uploads/logo.png',
      'http://127.0.0.1.evil.test:3001/uploads/logo.png',
      'http://user@127.0.0.1:3001/uploads/logo.png',
    ])('does not trust %s (it goes to the pinned client, which refuses private targets)', (url) => {
      expect(classifyRenderRequest(url, 'image', trusted)).toBe('fetch');
    });
  });

  it('aborts malformed look-alikes such as a non-numeric port', () => {
    expect(classifyRenderRequest('http://127.0.0.1:3001.evil.test/uploads/logo.png', 'image', trusted)).toBe('abort');
  });

  it('defaults the trusted prefixes from PORT', () => {
    const original = process.env.PORT;
    process.env.PORT = '4555';
    try {
      expect(classifyRenderRequest('http://127.0.0.1:4555/uploads/logo.png', 'image')).toBe('continue');
    } finally {
      if (original === undefined) delete process.env.PORT;
      else process.env.PORT = original;
    }
  });
});

describe('getTrustedAssetPrefixes', () => {
  it("derives the API's own /uploads/ prefix from PORT", () => {
    expect(getTrustedAssetPrefixes({ PORT: '4000' })).toEqual([
      'http://127.0.0.1:4000/uploads/',
      'http://localhost:4000/uploads/',
    ]);
  });

  it('defaults to port 3001', () => {
    expect(getTrustedAssetPrefixes({})).toEqual(['http://127.0.0.1:3001/uploads/', 'http://localhost:3001/uploads/']);
  });
});
