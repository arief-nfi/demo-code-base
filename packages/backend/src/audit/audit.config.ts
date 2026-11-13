// ─── Entity Filtering ──────────────────────────────────────────────

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'READ';

export interface AuditFilterConfig {
  /** If set, ONLY these models are audited (allowlist mode) */
  include?: string[];

  /** If set, these models are excluded from auditing (blocklist mode) */
  exclude?: string[];

  /** Per-model action filtering — only the listed actions are audited for that model */
  actions?: Record<string, AuditAction[]>;
}

/** Default: audit everything except the AuditLog model itself */
export const DEFAULT_AUDIT_FILTER: AuditFilterConfig = {
  exclude: ['AuditLog'],
};

// ─── Stored Entity Filter (per-tenant) ──────────────────────────────

/**
 * Shape stored in the DB `entityFilter` Json column.
 * Uses explicit `mode` instead of separate include/exclude to avoid ambiguity.
 */
export interface StoredEntityFilter {
  mode: 'include' | 'exclude';
  entities: string[];
  actions?: Record<string, AuditAction[]>;
}

/**
 * Convert a stored entity filter to the AuditFilterConfig expected by shouldAudit().
 * Safety: AuditLog is always excluded (stripped from include, force-added to exclude).
 */
export function toAuditFilterConfig(stored: StoredEntityFilter): AuditFilterConfig {
  const config: AuditFilterConfig = {};

  if (stored.mode === 'include') {
    config.include = stored.entities.filter((e) => e !== 'AuditLog');
  } else {
    const entities = new Set(stored.entities);
    entities.add('AuditLog');
    config.exclude = Array.from(entities);
  }

  if (stored.actions && Object.keys(stored.actions).length > 0) {
    config.actions = stored.actions;
  }

  return config;
}

/**
 * Determine whether a given model + action should be audited.
 *
 * Rules (evaluated in order):
 * 1. `include` (allowlist) — if set, the model must be in the list.
 * 2. `exclude` (blocklist) — if set, the model must NOT be in the list.
 * 3. `actions` — if the model has an entry, the action must be in its list.
 *
 * `include` and `exclude` are mutually exclusive; if both are provided
 * `include` takes precedence and `exclude` is ignored.
 */
export function shouldAudit(
  model: string,
  action: AuditAction,
  config: AuditFilterConfig = DEFAULT_AUDIT_FILTER,
): boolean {
  // Allowlist mode — model must be listed
  if (config.include) {
    if (!config.include.includes(model)) return false;
  } else if (config.exclude) {
    // Blocklist mode — model must not be listed
    if (config.exclude.includes(model)) return false;
  }

  // Per-model action filtering
  if (config.actions?.[model]) {
    if (!config.actions[model].includes(action)) return false;
  }

  return true;
}

// ─── Scheduled Retention Policy ───────────────────────────────────

export interface AuditRetentionPolicy {
  /** Whether automatic retention is enabled */
  enabled: boolean;

  /** Retention strategy: delete by age or keep N most recent */
  type: 'time' | 'count';

  /** For time-based: number of days to retain (e.g. 90 = delete logs older than 90 days) */
  retainDays?: number;

  /** For count-based: number of most recent records to keep */
  keepCount?: number;

  /** Whether to backup logs before deletion */
  backup: boolean;
}

/** Global default retention policy — disabled by default */
export const DEFAULT_RETENTION_POLICY: AuditRetentionPolicy = {
  enabled: false,
  type: 'time',
  retainDays: 90,
  backup: true,
};

// ─── Hash Chain for Tamper Evidence ───────────────────────────────

import { createHash } from 'crypto';

export interface AuditHashPayload {
  action: string;
  entity: string;
  entityId: string;
  userId?: string;
  tenantSlug?: string;
  changes?: unknown;
  timestamp: string; // ISO string
  previousHash: string | null;
}

/**
 * Stable JSON serialization with recursively sorted keys.
 *
 * PostgreSQL's `jsonb` type does NOT preserve key insertion order — it stores
 * keys in sorted order. Plain `JSON.stringify` is key-order-dependent, so a
 * hash computed before storage will differ from one computed after retrieval.
 * This function produces the same output regardless of key order.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  // Date (and any object with toJSON) must be serialized via JSON.stringify
  // so they produce the same output as after a jsonb round-trip (where they
  // become plain strings).
  if (typeof (value as Record<string, unknown>).toJSON === 'function') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(
    (k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]),
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute a SHA-256 hash for an audit log entry.
 *
 * The hash includes the entry's content fields plus the previous entry's hash,
 * forming a chain. If any entry is modified or deleted, the chain breaks.
 *
 * Uses `stableStringify` for deterministic serialization — key order is
 * normalised so the hash is consistent before and after PostgreSQL jsonb
 * round-trips.
 */
export function computeAuditHash(payload: AuditHashPayload): string {
  const canonical = stableStringify({
    action: payload.action,
    entity: payload.entity,
    entityId: payload.entityId,
    userId: payload.userId ?? null,
    tenantSlug: payload.tenantSlug ?? null,
    changes: payload.changes ?? null,
    timestamp: payload.timestamp,
    previousHash: payload.previousHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface VerifyResult {
  verified: boolean;
  checkedCount: number;
  firstEntry?: string; // ISO timestamp
  lastEntry?: string;  // ISO timestamp
  brokenAt?: {
    id: string;
    timestamp: string;
    expectedHash: string;
    actualHash: string | null;
  };
}

/** Special hash value stored after retention/deletion to mark a chain reset */
export const CHAIN_RESET_HASH = '__CHAIN_RESET__';

// ─── Batch Detail Capture ─────────────────────────────────────────

/**
 * Maximum number of records to capture in detail for batch operations.
 * When a batch exceeds this limit, the detail list is truncated and
 * a `truncated` flag is added to the audit entry.
 */
export const BATCH_DETAIL_LIMIT = 100;

// ─── Sensitive Field Redaction ─────────────────────────────────────

/**
 * Sensitive field configuration for audit log redaction.
 *
 * Fields listed here will be replaced with '[REDACTED]' in audit log
 * changes (before, after, updated) to prevent storing credentials,
 * tokens, and other sensitive data in the audit trail.
 *
 * Use '*' key for global fields that apply to all models.
 * Use model name keys for model-specific fields.
 */
export const AUDIT_SENSITIVE_FIELDS: Record<string, string[]> = {
  // Global fields — applies to all models
  '*': [
    'password',
    'refreshToken',
    'refreshTokenHash',
    'refreshTokenExpiresAt',
    'resetPasswordToken',
    'resetPasswordExpires',
    'secret',
    'token',
    'apiKey',
    'apiSecret',
    'secretKey',
  ],
};

export const REDACTED_VALUE = '[REDACTED]';

/**
 * Redact sensitive fields from audit log data.
 * Returns a shallow copy with sensitive values replaced by '[REDACTED]'.
 */
export function redactSensitiveFields(
  model: string,
  data: Record<string, unknown>,
  config: Record<string, string[]> = AUDIT_SENSITIVE_FIELDS,
): Record<string, unknown> {
  if (!data || typeof data !== 'object') return data;

  const globalFields = config['*'] ?? [];
  const modelFields = config[model] ?? [];
  const sensitiveFields = new Set([...globalFields, ...modelFields]);

  const redacted = { ...data };
  for (const field of sensitiveFields) {
    if (field in redacted) {
      redacted[field] = REDACTED_VALUE;
    }
  }
  return redacted;
}

// ─── Ignored Field Stripping ──────────────────────────────────────

/**
 * Fields to completely exclude from audit log changes.
 *
 * Unlike sensitive field redaction (which replaces values with '[REDACTED]'),
 * ignored fields are removed entirely from the changes object.
 * If an update only changes ignored fields, the audit record is skipped.
 *
 * Use '*' key for global fields that apply to all models.
 * Use model name keys for model-specific fields.
 */
export const AUDIT_IGNORED_FIELDS: Record<string, string[]> = {
  '*': ['createdAt', 'updatedAt'],
  'User': ['refreshTokenHash', 'refreshTokenExpiresAt'],
};

/**
 * Strip ignored fields from audit log data.
 * Returns a shallow copy with ignored fields removed entirely.
 */
export function stripIgnoredFields(
  model: string,
  data: Record<string, unknown>,
  config: Record<string, string[]> = AUDIT_IGNORED_FIELDS,
): Record<string, unknown> {
  if (!data || typeof data !== 'object') return data;

  const globalFields = config['*'] ?? [];
  const modelFields = config[model] ?? [];
  const ignoredFields = new Set([...globalFields, ...modelFields]);

  const result = { ...data };
  for (const field of ignoredFields) {
    delete result[field];
  }
  return result;
}
