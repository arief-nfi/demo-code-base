import { isIP } from 'net';

/**
 * IPv4 ranges that must never be the target of a server-side request
 * (loopback, RFC 1918, link-local / cloud metadata, CGNAT, multicast, ...).
 */
const IPV4_BLOCKED_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata endpoints live here)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1 (documentation)
  ['192.88.99.0', 24], // deprecated 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2 (documentation)
  ['203.0.113.0', 24], // TEST-NET-3 (documentation)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255 broadcast
];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

const IPV4_BLOCKED = IPV4_BLOCKED_RANGES.map(([base, prefix]) => {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { network: (ipv4ToInt(base) & mask) >>> 0, mask };
});

function isBlockedIPv4Int(value: number): boolean {
  return IPV4_BLOCKED.some(({ network, mask }) => ((value & mask) >>> 0) === network);
}

/** Parses a valid IPv6 string (optionally with an embedded dotted IPv4 tail) into 8 hextets. */
function parseIPv6(ip: string): number[] {
  let address = ip;
  const lastColon = address.lastIndexOf(':');
  if (address.includes('.', lastColon)) {
    const v4 = ipv4ToInt(address.slice(lastColon + 1));
    address = `${address.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const [head, tail] = address.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail === undefined ? [] : new Array(8 - headParts.length - tailParts.length).fill('0');

  return [...headParts, ...fill, ...tailParts].map((part) => parseInt(part, 16));
}

function isBlockedIPv6(h: number[]): boolean {
  const embeddedV4 = ((h[6] << 16) | h[7]) >>> 0;
  const zeroUpTo = (n: number) => h.slice(0, n).every((x) => x === 0);

  // ::/96 — unspecified (::), loopback (::1) and deprecated IPv4-compatible addresses
  if (zeroUpTo(6)) return isBlockedIPv4Int(embeddedV4);
  // ::ffff:0:0/96 — IPv4-mapped
  if (zeroUpTo(5) && h[5] === 0xffff) return isBlockedIPv4Int(embeddedV4);
  // ::ffff:0:0:0/96 — IPv4-translated (SIIT)
  if (zeroUpTo(4) && h[4] === 0xffff && h[5] === 0) return isBlockedIPv4Int(embeddedV4);
  // 64:ff9b::/96 — NAT64 well-known prefix maps onto IPv4
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIPv4Int(embeddedV4);
  }
  // 64:ff9b:1::/48 — local-use NAT64
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return true;
  // 2002::/16 — 6to4 embeds an IPv4 address in bits 16..47
  if (h[0] === 0x2002) return isBlockedIPv4Int(((h[1] << 16) | h[2]) >>> 0);
  // 2001::/32 Teredo tunnelling, 2001:db8::/32 documentation
  if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0x0db8)) return true;
  // 100::/64 — discard-only
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

/**
 * Returns true when `ip` is loopback, private, link-local, multicast or
 * otherwise reserved — i.e. anything a server-side request must not reach.
 * Accepts IPv4, IPv6 (with optional zone id or surrounding brackets),
 * IPv4-mapped and NAT64 forms. Anything that is not a valid IP literal is
 * treated as unsafe.
 */
export function isPrivateOrReservedAddress(ip: string): boolean {
  let address = ip.trim();
  if (address.startsWith('[') && address.endsWith(']')) {
    address = address.slice(1, -1);
  }
  address = address.split('%')[0];

  const family = isIP(address);
  if (family === 4) return isBlockedIPv4Int(ipv4ToInt(address));
  if (family === 6) return isBlockedIPv6(parseIPv6(address.toLowerCase()));
  return true;
}
