import { isPrivateOrReservedAddress } from './ip-address';

describe('isPrivateOrReservedAddress', () => {
  describe('IPv4', () => {
    it.each([
      ['0.0.0.0', 'this network'],
      ['0.255.255.255', 'this network'],
      ['10.0.0.1', 'private 10/8'],
      ['10.255.255.255', 'private 10/8'],
      ['100.64.0.1', 'CGNAT 100.64/10'],
      ['100.127.255.255', 'CGNAT 100.64/10'],
      ['127.0.0.1', 'loopback'],
      ['127.255.255.254', 'loopback'],
      ['169.254.169.254', 'link-local / cloud metadata'],
      ['172.16.0.1', 'private 172.16/12'],
      ['172.31.255.255', 'private 172.16/12'],
      ['192.0.0.8', 'IETF protocol assignments'],
      ['192.168.1.1', 'private 192.168/16'],
      ['198.18.0.1', 'benchmarking 198.18/15'],
      ['198.19.255.255', 'benchmarking 198.18/15'],
      ['224.0.0.1', 'multicast'],
      ['239.255.255.250', 'multicast'],
      ['240.0.0.1', 'reserved 240/4'],
      ['255.255.255.255', 'broadcast'],
    ])('rejects %s (%s)', (ip) => {
      expect(isPrivateOrReservedAddress(ip)).toBe(true);
    });

    it.each([
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '100.63.255.255', // just below CGNAT
      '100.128.0.0', // just above CGNAT
      '172.15.255.255', // just below 172.16/12
      '172.32.0.0', // just above 172.16/12
      '192.0.1.1',
      '198.17.255.255',
      '198.20.0.0',
      '223.255.255.255',
    ])('allows public address %s', (ip) => {
      expect(isPrivateOrReservedAddress(ip)).toBe(false);
    });
  });

  describe('IPv6', () => {
    it.each([
      ['::', 'unspecified'],
      ['::1', 'loopback'],
      ['0:0:0:0:0:0:0:1', 'loopback (expanded)'],
      ['fc00::1', 'unique local'],
      ['fd12:3456:789a::1', 'unique local'],
      ['fe80::1', 'link-local'],
      ['fe80::1%eth0', 'link-local with zone id'],
      ['febf::1', 'link-local upper bound'],
      ['ff02::1', 'multicast'],
      ['::ffff:127.0.0.1', 'IPv4-mapped loopback (dotted)'],
      ['::ffff:7f00:1', 'IPv4-mapped loopback (hex, as normalised by WHATWG URL)'],
      ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
      ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata (hex)'],
      ['::ffff:0:127.0.0.1', 'IPv4-translated loopback (dotted)'],
      ['::ffff:0:7f00:1', 'IPv4-translated loopback (hex)'],
      ['::ffff:0:a9fe:a9fe', 'IPv4-translated metadata'],
      ['::ffff:0:10.1.2.3', 'IPv4-translated private'],
      ['64:ff9b::7f00:1', 'NAT64 loopback'],
      ['64:ff9b::10.0.0.1', 'NAT64 private'],
      ['[::1]', 'bracketed loopback'],
    ])('rejects %s (%s)', (ip) => {
      expect(isPrivateOrReservedAddress(ip)).toBe(true);
    });

    it.each([
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
      '::ffff:8.8.8.8',
      '::ffff:0:8.8.8.8', // IPv4-translated 8.8.8.8
      '64:ff9b::808:808', // NAT64 of 8.8.8.8
    ])('allows public address %s', (ip) => {
      expect(isPrivateOrReservedAddress(ip)).toBe(false);
    });
  });

  it.each(['', 'not-an-ip', 'example.com', '256.1.1.1', '1.2.3', 'gggg::1'])(
    'treats non-IP input %p as unsafe',
    (input) => {
      expect(isPrivateOrReservedAddress(input)).toBe(true);
    },
  );
});
