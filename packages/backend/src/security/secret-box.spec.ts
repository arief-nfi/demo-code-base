import { randomBytes } from 'crypto';
import { createSecretBox } from './secret-box';

const KEY = randomBytes(32).toString('base64');

describe('createSecretBox', () => {
  it('seal then open returns the original', () => {
    const box = createSecretBox(KEY);
    const sealed = box.seal('1//refresh-token-value');

    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('refresh-token-value');
    expect(box.open(sealed)).toBe('1//refresh-token-value');
  });

  it('the same plain text seals differently each time (random IV)', () => {
    const box = createSecretBox(KEY);
    expect(box.seal('same')).not.toBe(box.seal('same'));
  });

  it('open with another key throws', () => {
    const sealed = createSecretBox(KEY).seal('secret');
    expect(() => createSecretBox(randomBytes(32).toString('base64')).open(sealed)).toThrow();
  });

  it('a flipped ciphertext byte throws', () => {
    const box = createSecretBox(KEY);
    const raw = Buffer.from(box.seal('secret').slice(3), 'base64');
    raw[raw.length - 1] ^= 0x01;
    expect(() => box.open(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('an unknown prefix throws', () => {
    const box = createSecretBox(KEY);
    expect(() => box.open(box.seal('secret').replace(/^v1:/, 'v2:'))).toThrow();
    expect(() => box.open('plain-text')).toThrow();
  });

  it('a key that is not 32 bytes is refused', () => {
    expect(() => createSecretBox(randomBytes(16).toString('base64'))).toThrow('INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64');
    expect(() => createSecretBox('')).toThrow('INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64');
  });

  it('a secret sealed for one context opens only with that context', () => {
    const box = createSecretBox(Buffer.alloc(32, 3).toString('base64'));
    const sealed = box.seal('refresh-token', 'acme:u1');

    expect(box.open(sealed, 'acme:u1')).toBe('refresh-token');
    expect(() => box.open(sealed, 'acme:u2')).toThrow();
    expect(() => box.open(sealed)).toThrow();
  });
});
