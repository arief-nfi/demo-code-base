/**
 * Redacts sensitive fields from plugin configuration objects
 * before they appear in audit logs or event payloads.
 */

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /private[_-]?key/i,
  /connection[_-]?string/i,
];

const REDACTED = '[REDACTED]';

export function redactSensitiveConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactSensitiveConfig(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}
