import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretBox {
  /**
   * Encrypts a secret for storage: `v1:<base64(iv | tag | ciphertext)>`. `context` (e.g. the
   * owning row's tenant and user) is authenticated but not stored: opening needs the same one,
   * so a sealed value copied to another row is useless.
   */
  seal(plain: string, context?: string): string;
  /** Decrypts what `seal` produced; throws on a wrong key or context, tampering or an unknown format */
  open(sealed: string, context?: string): string;
}

/**
 * AES-256-GCM for secrets stored at rest (e.g. OAuth refresh tokens). The `v1:`
 * prefix leaves room for key rotation later.
 */
export function createSecretBox(base64Key: string): SecretBox {
  const key = Buffer.from(base64Key ?? '', 'base64');
  if (key.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64');

  return {
    seal(plain, context = '') {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return VERSION + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
    },
    open(sealed, context = '') {
      if (!sealed.startsWith(VERSION)) throw new Error('Unknown secret format');
      const raw = Buffer.from(sealed.slice(VERSION.length), 'base64');
      if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error('Unknown secret format');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
    },
  };
}
