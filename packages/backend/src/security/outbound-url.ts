import { promises as dnsPromises, type LookupAddress } from 'dns';
import { isIP, type LookupFunction } from 'net';
import { isPrivateOrReservedAddress } from './ip-address';

/**
 * Thrown when an outbound URL is refused by the SSRF policy (bad scheme,
 * embedded credentials, or a host that is/resolves to a private address).
 * DNS failures are NOT wrapped in this error — they propagate unchanged so
 * callers can treat them as ordinary (retryable) network errors.
 */
export class UnsafeOutboundUrlError extends Error {
  readonly code = 'ERR_UNSAFE_OUTBOUND_URL';

  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutboundUrlError';
  }
}

export interface OutboundUrlOptions {
  /** Skip the private/reserved address checks. Local development only. */
  allowPrivate?: boolean;
}

function assertPublicAddresses(hostname: string, addresses: LookupAddress[]): void {
  if (addresses.length === 0) {
    throw new UnsafeOutboundUrlError(`Host ${hostname} did not resolve to any address`);
  }
  const blocked = addresses.find((a) => isPrivateOrReservedAddress(a.address));
  if (blocked) {
    throw new UnsafeOutboundUrlError(`Host ${hostname} resolves to private or reserved address ${blocked.address}`);
  }
}

/**
 * Validates a URL before the server makes a request to it:
 * - http/https only, no `user:pass@` credentials
 * - literal IP hosts must be public
 * - hostnames are resolved (ALL A/AAAA records) and every record must be public
 *
 * Returns the parsed URL. Note that a later connection resolves DNS again — use
 * `createSafeLookup()` (or `safeHttpRequest()`) to re-validate at connect time.
 */
export async function assertSafeOutboundUrl(rawUrl: string, options: OutboundUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeOutboundUrlError('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeOutboundUrlError(`Only http and https URLs are allowed (got "${url.protocol}")`);
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError('URLs must not contain credentials');
  }
  if (options.allowPrivate) {
    return url;
  }

  // WHATWG URL already normalises odd IPv4 forms (decimal, hex, short) to dotted quads.
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(hostname)) {
    if (isPrivateOrReservedAddress(hostname)) {
      throw new UnsafeOutboundUrlError(`Host ${hostname} is a private or reserved address`);
    }
    return url;
  }

  const addresses = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  assertPublicAddresses(hostname, addresses);
  return url;
}

/**
 * A `lookup` function for `http.request` / `net.connect` that refuses to hand
 * back private or reserved addresses. Because the socket connects to exactly
 * the addresses validated here, this pins the request to vetted IPs and
 * defeats DNS rebinding between a pre-flight check and the connection.
 *
 * Literal IP hosts never reach `lookup` (Node connects directly), so always
 * run `assertSafeOutboundUrl()` first.
 */
export function createSafeLookup(options: OutboundUrlOptions = {}): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    dnsPromises
      .lookup(hostname, { ...lookupOptions, all: true })
      .then((addresses) => {
        if (!options.allowPrivate) {
          assertPublicAddresses(hostname, addresses);
        }
        if (lookupOptions?.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, ''));
  };
}
