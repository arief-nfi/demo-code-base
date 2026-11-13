import { createHash } from 'crypto';

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/**
 * The Google event id for one synced event: deterministic, so a retried insert finds
 * the event it already made instead of duplicating it. Google ids allow base32hex
 * characters (0-9, a-v), 5–1024 long; this is the SHA-256 of the parts, 52 characters.
 */
export function googleEventId(tenantSlug: string, userId: string, source: string, key: string): string {
  const bytes = createHash('sha256').update(JSON.stringify([tenantSlug, userId, source, key])).digest();
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32HEX[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}
