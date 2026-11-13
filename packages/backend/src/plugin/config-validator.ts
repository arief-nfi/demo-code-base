/**
 * Plugin configuration validator.
 * Enforces size, depth, and key count limits to prevent abuse.
 */

const MAX_SIZE_BYTES = 64 * 1024; // 64KB
const MAX_DEPTH = 5;
const MAX_KEYS = 100;

export interface ConfigValidationResult {
  valid: boolean;
  error?: string;
}

export function validatePluginConfig(config: unknown): ConfigValidationResult {
  // Must be a plain object
  if (config === null || config === undefined || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, error: 'Config must be a plain object' };
  }

  // Check for circular references via JSON.stringify
  let serialized: string;
  try {
    serialized = JSON.stringify(config);
  } catch {
    return { valid: false, error: 'Config contains circular references or non-serializable values' };
  }

  // Check serialized size
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (sizeBytes > MAX_SIZE_BYTES) {
    return { valid: false, error: `Config exceeds maximum size of ${MAX_SIZE_BYTES} bytes (got ${sizeBytes})` };
  }

  // Check depth
  const depth = measureDepth(config as Record<string, unknown>);
  if (depth > MAX_DEPTH) {
    return { valid: false, error: `Config exceeds maximum nesting depth of ${MAX_DEPTH} (got ${depth})` };
  }

  // Check total key count
  const keys = countKeys(config as Record<string, unknown>);
  if (keys > MAX_KEYS) {
    return { valid: false, error: `Config exceeds maximum key count of ${MAX_KEYS} (got ${keys})` };
  }

  return { valid: true };
}

function measureDepth(obj: Record<string, unknown>, current = 1): number {
  let max = current;
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const childDepth = measureDepth(value as Record<string, unknown>, current + 1);
      if (childDepth > max) max = childDepth;
    }
  }
  return max;
}

function countKeys(obj: Record<string, unknown>): number {
  let count = Object.keys(obj).length;
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      count += countKeys(value as Record<string, unknown>);
    }
  }
  return count;
}
