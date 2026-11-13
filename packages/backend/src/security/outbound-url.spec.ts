import * as dns from 'dns';
import { assertSafeOutboundUrl, createSafeLookup, UnsafeOutboundUrlError } from './outbound-url';

describe('assertSafeOutboundUrl', () => {
  let lookupSpy: jest.SpyInstance;

  beforeEach(() => {
    lookupSpy = jest.spyOn(dns.promises, 'lookup');
  });

  afterEach(() => {
    lookupSpy.mockRestore();
  });

  const resolvesTo = (...addresses: string[]) =>
    lookupSpy.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));

  it.each([
    ['not a url', /invalid url/i],
    ['ftp://example.com/file', /only http and https/i],
    ['file:///etc/passwd', /only http and https/i],
    ['javascript:alert(1)', /only http and https/i],
    ['https://user:pass@example.com/hook', /credentials/i],
    ['https://user@example.com/hook', /credentials/i],
  ])('rejects %s', async (url, message) => {
    resolvesTo('93.184.216.34');
    await expect(assertSafeOutboundUrl(url)).rejects.toThrow(UnsafeOutboundUrlError);
    await expect(assertSafeOutboundUrl(url)).rejects.toThrow(message);
  });

  it.each([
    'http://127.0.0.1:59123/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/hook',
    'http://2130706433/', // decimal 127.0.0.1, normalised by the URL parser
    'http://0x7f.1/', // hex/short form of 127.0.0.1
    'http://[::1]:8080/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://0.0.0.0/',
  ])('rejects literal private/reserved address %s without a DNS lookup', async (url) => {
    await expect(assertSafeOutboundUrl(url)).rejects.toThrow(/private or reserved/i);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('tags policy errors with a stable code (safe to check across duplicate module copies)', async () => {
    const err = await assertSafeOutboundUrl('http://127.0.0.1/').catch((e) => e);
    expect(err.code).toBe('ERR_UNSAFE_OUTBOUND_URL');
    expect(err.name).toBe('UnsafeOutboundUrlError');
  });

  it('rejects a hostname when ANY resolved record is private', async () => {
    resolvesTo('93.184.216.34', '10.1.2.3');
    await expect(assertSafeOutboundUrl('https://mixed.example.com/hook')).rejects.toThrow(
      'Host mixed.example.com resolves to private or reserved address 10.1.2.3',
    );
    expect(lookupSpy).toHaveBeenCalledWith('mixed.example.com', expect.objectContaining({ all: true }));
  });

  it('rejects localhost-style names that resolve to loopback', async () => {
    resolvesTo('::1', '127.0.0.1');
    await expect(assertSafeOutboundUrl('http://localhost:3001/')).rejects.toThrow(UnsafeOutboundUrlError);
  });

  it('accepts a hostname whose records are all public', async () => {
    resolvesTo('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946');
    const url = await assertSafeOutboundUrl('https://example.com/webhook?x=1');
    expect(url.href).toBe('https://example.com/webhook?x=1');
  });

  it('accepts a literal public IP without a DNS lookup', async () => {
    await expect(assertSafeOutboundUrl('http://8.8.8.8/')).resolves.toBeInstanceOf(URL);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('propagates DNS failures as ordinary (non-policy) errors', async () => {
    lookupSpy.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND nope.invalid'), { code: 'ENOTFOUND' }));
    const err = await assertSafeOutboundUrl('https://nope.invalid/').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnsafeOutboundUrlError);
    expect(err.code).toBe('ENOTFOUND');
  });

  describe('allowPrivate', () => {
    it('skips the address checks (and DNS) for private targets', async () => {
      await expect(assertSafeOutboundUrl('http://127.0.0.1:59123/', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
      await expect(assertSafeOutboundUrl('http://localhost/', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
      expect(lookupSpy).not.toHaveBeenCalled();
    });

    it('still enforces scheme and credential rules', async () => {
      await expect(assertSafeOutboundUrl('ftp://127.0.0.1/', { allowPrivate: true })).rejects.toThrow(/only http and https/i);
      await expect(assertSafeOutboundUrl('http://a:b@127.0.0.1/', { allowPrivate: true })).rejects.toThrow(/credentials/i);
    });
  });
});

describe('createSafeLookup', () => {
  let lookupSpy: jest.SpyInstance;

  beforeEach(() => {
    lookupSpy = jest.spyOn(dns.promises, 'lookup');
  });

  afterEach(() => {
    lookupSpy.mockRestore();
  });

  const callLookup = (lookup: ReturnType<typeof createSafeLookup>, options: dns.LookupOptions) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
      lookup('host.example', options, (err, address, family) => resolve({ err, address, family }));
    });

  it('returns the first validated address for single lookups', async () => {
    lookupSpy.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const result = await callLookup(createSafeLookup(), {});
    expect(result).toEqual({ err: null, address: '93.184.216.34', family: 4 });
  });

  it('returns all validated addresses when all: true (happy-eyeballs connect)', async () => {
    const records = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ];
    lookupSpy.mockResolvedValue(records);
    const result = await callLookup(createSafeLookup(), { all: true });
    expect(result.err).toBeNull();
    expect(result.address).toEqual(records);
  });

  it('fails the connection when any record is private (DNS rebinding)', async () => {
    lookupSpy.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const result = await callLookup(createSafeLookup(), { all: true });
    expect(result.err).toBeInstanceOf(UnsafeOutboundUrlError);
    expect(result.err?.message).toMatch(/169\.254\.169\.254/);
  });

  it('lets private records through when allowPrivate is set', async () => {
    lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const result = await callLookup(createSafeLookup({ allowPrivate: true }), {});
    expect(result).toEqual({ err: null, address: '127.0.0.1', family: 4 });
  });

  it('passes DNS errors through', async () => {
    lookupSpy.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND host.example'), { code: 'ENOTFOUND' }));
    const result = await callLookup(createSafeLookup(), {});
    expect(result.err?.code).toBe('ENOTFOUND');
  });
});
