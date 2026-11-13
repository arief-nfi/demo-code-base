import {
  redactSensitiveFields,
  AUDIT_SENSITIVE_FIELDS,
  REDACTED_VALUE,
  stripIgnoredFields,
  AUDIT_IGNORED_FIELDS,
  shouldAudit,
  DEFAULT_AUDIT_FILTER,
  AuditFilterConfig,
  computeAuditHash,
  stableStringify,
  AuditHashPayload,
  CHAIN_RESET_HASH,
  BATCH_DETAIL_LIMIT,
  StoredEntityFilter,
  toAuditFilterConfig,
} from './audit.config';

describe('redactSensitiveFields', () => {
  it('should redact global sensitive fields from any model', () => {
    const data = {
      id: 'user-1',
      name: 'John',
      email: 'john@test.com',
      password: '$2b$10$hashedpassword',
      refreshTokenHash: 'abc123hash',
    };

    const result = redactSensitiveFields('User', data);

    expect(result.id).toBe('user-1');
    expect(result.name).toBe('John');
    expect(result.email).toBe('john@test.com');
    expect(result.password).toBe(REDACTED_VALUE);
    expect(result.refreshTokenHash).toBe(REDACTED_VALUE);
  });

  it('should redact all globally configured fields', () => {
    const globalFields = AUDIT_SENSITIVE_FIELDS['*'];
    const data: Record<string, string> = {};
    for (const field of globalFields) {
      data[field] = `value-of-${field}`;
    }
    data['safeField'] = 'visible';

    const result = redactSensitiveFields('AnyModel', data);

    for (const field of globalFields) {
      expect(result[field]).toBe(REDACTED_VALUE);
    }
    expect(result['safeField']).toBe('visible');
  });

  it('should handle model-specific sensitive fields', () => {
    // Add a temporary model-specific config for testing
    const originalConfig = { ...AUDIT_SENSITIVE_FIELDS };
    AUDIT_SENSITIVE_FIELDS['TestModel'] = ['customSecret'];

    const data = {
      id: 'test-1',
      customSecret: 'my-secret-value',
      name: 'Test',
    };

    const result = redactSensitiveFields('TestModel', data);

    expect(result.customSecret).toBe(REDACTED_VALUE);
    expect(result.name).toBe('Test');

    // Cleanup
    delete AUDIT_SENSITIVE_FIELDS['TestModel'];
    Object.assign(AUDIT_SENSITIVE_FIELDS, originalConfig);
  });

  it('should combine global and model-specific fields', () => {
    AUDIT_SENSITIVE_FIELDS['SpecialModel'] = ['internalCode'];

    const data = {
      id: 'item-1',
      password: 'secret123',
      internalCode: 'CODE-999',
      name: 'Visible',
    };

    const result = redactSensitiveFields('SpecialModel', data);

    expect(result.password).toBe(REDACTED_VALUE); // from global
    expect(result.internalCode).toBe(REDACTED_VALUE); // from model-specific
    expect(result.name).toBe('Visible');

    // Cleanup
    delete AUDIT_SENSITIVE_FIELDS['SpecialModel'];
  });

  it('should not modify fields that are not in the sensitive list', () => {
    const data = {
      id: 'user-1',
      name: 'John',
      email: 'john@test.com',
      role: 'ADMIN',
      createdAt: '2026-01-01',
    };

    const result = redactSensitiveFields('User', data);

    expect(result).toEqual(data);
  });

  it('should return a new object without mutating the original', () => {
    const data = {
      id: 'user-1',
      password: 'original-password',
    };

    const result = redactSensitiveFields('User', data);

    expect(result.password).toBe(REDACTED_VALUE);
    expect(data.password).toBe('original-password'); // original untouched
  });

  it('should handle null data gracefully', () => {
    const result = redactSensitiveFields('User', null as any);
    expect(result).toBeNull();
  });

  it('should handle undefined data gracefully', () => {
    const result = redactSensitiveFields('User', undefined as any);
    expect(result).toBeUndefined();
  });

  it('should handle empty object', () => {
    const result = redactSensitiveFields('User', {});
    expect(result).toEqual({});
  });

  it('should handle models with no specific config (global only)', () => {
    const data = {
      id: 'item-1',
      password: 'secret',
      name: 'Test',
    };

    const result = redactSensitiveFields('UnknownModel', data);

    expect(result.password).toBe(REDACTED_VALUE);
    expect(result.name).toBe('Test');
  });

  it('should redact resetPasswordToken and resetPasswordExpires', () => {
    const data = {
      id: 'user-1',
      resetPasswordToken: 'abc123',
      resetPasswordExpires: new Date('2026-01-01'),
      name: 'John',
    };

    const result = redactSensitiveFields('User', data);

    expect(result.resetPasswordToken).toBe(REDACTED_VALUE);
    expect(result.resetPasswordExpires).toBe(REDACTED_VALUE);
    expect(result.name).toBe('John');
  });

  it('should handle fields with falsy values (empty string, 0, false)', () => {
    const data = {
      password: '',
      token: 0,
      secret: false,
      name: 'John',
    };

    const result = redactSensitiveFields('User', data as any);

    // Fields exist in the object, so they should be redacted regardless of value
    expect(result.password).toBe(REDACTED_VALUE);
    expect(result.token).toBe(REDACTED_VALUE);
    expect(result.secret).toBe(REDACTED_VALUE);
    expect(result.name).toBe('John');
  });

  it('should use custom config when provided', () => {
    const customConfig = { '*': ['email'], User: ['phone'] };
    const data = { id: 'user-1', name: 'John', email: 'john@test.com', phone: '123', password: 'secret' };

    const result = redactSensitiveFields('User', data, customConfig);

    expect(result.email).toBe(REDACTED_VALUE);
    expect(result.phone).toBe(REDACTED_VALUE);
    expect(result.password).toBe('secret'); // not in custom config
    expect(result.name).toBe('John');
  });
});

// ─── stripIgnoredFields ───────────────────────────────────────────

describe('stripIgnoredFields', () => {
  it('should remove global ignored fields from any model', () => {
    const data = {
      id: 'user-1',
      name: 'John',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const result = stripIgnoredFields('User', data);

    expect(result.id).toBe('user-1');
    expect(result.name).toBe('John');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('should remove model-specific ignored fields', () => {
    AUDIT_IGNORED_FIELDS['TestModel'] = ['internalFlag'];

    const data = { id: 'item-1', name: 'Test', internalFlag: true };
    const result = stripIgnoredFields('TestModel', data);

    expect(result.id).toBe('item-1');
    expect(result.name).toBe('Test');
    expect(result).not.toHaveProperty('internalFlag');

    delete AUDIT_IGNORED_FIELDS['TestModel'];
  });

  it('should combine global and model-specific ignored fields', () => {
    AUDIT_IGNORED_FIELDS['SpecialModel'] = ['computedScore'];

    const data = {
      id: 'item-1',
      name: 'Visible',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      computedScore: 99,
    };

    const result = stripIgnoredFields('SpecialModel', data);

    expect(result).toEqual({ id: 'item-1', name: 'Visible' });

    delete AUDIT_IGNORED_FIELDS['SpecialModel'];
  });

  it('should leave non-ignored fields untouched', () => {
    const data = { id: 'user-1', name: 'John', email: 'john@test.com' };
    const result = stripIgnoredFields('User', data);

    expect(result).toEqual(data);
  });

  it('should return data unchanged when no ignored fields match', () => {
    const data = { id: 'item-1', title: 'Hello' };
    const result = stripIgnoredFields('UnknownModel', data);

    expect(result).toEqual(data);
  });

  it('should handle null/non-object input gracefully', () => {
    expect(stripIgnoredFields('User', null as any)).toBeNull();
    expect(stripIgnoredFields('User', undefined as any)).toBeUndefined();
  });

  it('should return a new object without mutating the original', () => {
    const data = { id: 'user-1', name: 'John', updatedAt: '2026-01-01' };
    const result = stripIgnoredFields('User', data);

    expect(result).not.toHaveProperty('updatedAt');
    expect(data.updatedAt).toBe('2026-01-01'); // original untouched
  });

  it('should use custom config when provided', () => {
    const customConfig = { '*': ['internalId'], User: ['lastLoginAt'] };
    const data = { id: 'user-1', name: 'John', internalId: 'xyz', lastLoginAt: '2026-01-01', createdAt: '2026-01-01' };

    const result = stripIgnoredFields('User', data, customConfig);

    expect(result).not.toHaveProperty('internalId');
    expect(result).not.toHaveProperty('lastLoginAt');
    expect(result.createdAt).toBe('2026-01-01'); // not in custom config
    expect(result.name).toBe('John');
  });
});

// ─── shouldAudit ──────────────────────────────────────────────────

describe('shouldAudit', () => {
  describe('default config', () => {
    it('should exclude AuditLog by default', () => {
      expect(shouldAudit('AuditLog', 'CREATE')).toBe(false);
      expect(shouldAudit('AuditLog', 'UPDATE')).toBe(false);
      expect(shouldAudit('AuditLog', 'DELETE')).toBe(false);
    });

    it('should allow all other models by default', () => {
      expect(shouldAudit('User', 'CREATE')).toBe(true);
      expect(shouldAudit('Role', 'UPDATE')).toBe(true);
      expect(shouldAudit('Permission', 'DELETE')).toBe(true);
      expect(shouldAudit('TenantConfig', 'CREATE')).toBe(true);
    });
  });

  describe('include (allowlist) mode', () => {
    const config: AuditFilterConfig = {
      include: ['User', 'Role', 'Permission'],
    };

    it('should allow models in the include list', () => {
      expect(shouldAudit('User', 'CREATE', config)).toBe(true);
      expect(shouldAudit('Role', 'UPDATE', config)).toBe(true);
      expect(shouldAudit('Permission', 'DELETE', config)).toBe(true);
    });

    it('should reject models not in the include list', () => {
      expect(shouldAudit('TenantConfig', 'CREATE', config)).toBe(false);
      expect(shouldAudit('SampleItem', 'UPDATE', config)).toBe(false);
      expect(shouldAudit('AuditLog', 'CREATE', config)).toBe(false);
    });
  });

  describe('exclude (blocklist) mode', () => {
    const config: AuditFilterConfig = {
      exclude: ['AuditLog', 'Session', 'TempCache'],
    };

    it('should reject models in the exclude list', () => {
      expect(shouldAudit('AuditLog', 'CREATE', config)).toBe(false);
      expect(shouldAudit('Session', 'UPDATE', config)).toBe(false);
      expect(shouldAudit('TempCache', 'DELETE', config)).toBe(false);
    });

    it('should allow models not in the exclude list', () => {
      expect(shouldAudit('User', 'CREATE', config)).toBe(true);
      expect(shouldAudit('Role', 'DELETE', config)).toBe(true);
    });
  });

  describe('include takes precedence over exclude', () => {
    const config: AuditFilterConfig = {
      include: ['User', 'Role'],
      exclude: ['User'],  // should be ignored
    };

    it('should use include and ignore exclude', () => {
      expect(shouldAudit('User', 'CREATE', config)).toBe(true);   // in include, ignore exclude
      expect(shouldAudit('Role', 'UPDATE', config)).toBe(true);   // in include
      expect(shouldAudit('Permission', 'DELETE', config)).toBe(false); // not in include
    });
  });

  describe('per-model action filtering', () => {
    const config: AuditFilterConfig = {
      actions: {
        User: ['CREATE', 'UPDATE', 'DELETE'],
        Project: ['DELETE'],
      },
    };

    it('should allow actions listed for the model', () => {
      expect(shouldAudit('User', 'CREATE', config)).toBe(true);
      expect(shouldAudit('User', 'UPDATE', config)).toBe(true);
      expect(shouldAudit('User', 'DELETE', config)).toBe(true);
      expect(shouldAudit('Project', 'DELETE', config)).toBe(true);
    });

    it('should reject actions not listed for the model', () => {
      expect(shouldAudit('Project', 'CREATE', config)).toBe(false);
      expect(shouldAudit('Project', 'UPDATE', config)).toBe(false);
    });

    it('should allow all actions for models without an actions entry', () => {
      expect(shouldAudit('Role', 'CREATE', config)).toBe(true);
      expect(shouldAudit('Role', 'UPDATE', config)).toBe(true);
      expect(shouldAudit('Role', 'DELETE', config)).toBe(true);
    });
  });

  describe('combined include + actions', () => {
    const config: AuditFilterConfig = {
      include: ['User', 'Project'],
      actions: {
        Project: ['DELETE'],
      },
    };

    it('should require both include and action match', () => {
      expect(shouldAudit('User', 'CREATE', config)).toBe(true);     // in include, no action filter
      expect(shouldAudit('Project', 'DELETE', config)).toBe(true);   // in include + action match
      expect(shouldAudit('Project', 'CREATE', config)).toBe(false);  // in include but action mismatch
      expect(shouldAudit('Role', 'CREATE', config)).toBe(false);     // not in include
    });
  });

  describe('combined exclude + actions', () => {
    const config: AuditFilterConfig = {
      exclude: ['AuditLog'],
      actions: {
        Project: ['DELETE'],
      },
    };

    it('should apply both exclude and action filtering', () => {
      expect(shouldAudit('AuditLog', 'CREATE', config)).toBe(false);  // excluded
      expect(shouldAudit('User', 'CREATE', config)).toBe(true);       // not excluded, no action filter
      expect(shouldAudit('Project', 'DELETE', config)).toBe(true);    // not excluded, action match
      expect(shouldAudit('Project', 'UPDATE', config)).toBe(false);   // not excluded, action mismatch
    });
  });

  describe('empty config', () => {
    it('should allow everything with empty config', () => {
      const config: AuditFilterConfig = {};
      expect(shouldAudit('User', 'CREATE', config)).toBe(true);
      expect(shouldAudit('AuditLog', 'DELETE', config)).toBe(true);
      expect(shouldAudit('Whatever', 'UPDATE', config)).toBe(true);
    });
  });

  describe('DEFAULT_AUDIT_FILTER', () => {
    it('should only exclude AuditLog', () => {
      expect(DEFAULT_AUDIT_FILTER).toEqual({ exclude: ['AuditLog'] });
    });
  });
});

// ─── toAuditFilterConfig ─────────────────────────────────────────

describe('toAuditFilterConfig', () => {
  it('should convert include mode to AuditFilterConfig', () => {
    const stored: StoredEntityFilter = { mode: 'include', entities: ['User', 'Role'] };
    const result = toAuditFilterConfig(stored);
    expect(result).toEqual({ include: ['User', 'Role'] });
  });

  it('should convert exclude mode and always add AuditLog', () => {
    const stored: StoredEntityFilter = { mode: 'exclude', entities: ['Session'] };
    const result = toAuditFilterConfig(stored);
    expect(result.exclude).toContain('AuditLog');
    expect(result.exclude).toContain('Session');
  });

  it('should not duplicate AuditLog in exclude list', () => {
    const stored: StoredEntityFilter = { mode: 'exclude', entities: ['AuditLog', 'Session'] };
    const result = toAuditFilterConfig(stored);
    const auditLogCount = result.exclude!.filter((e) => e === 'AuditLog').length;
    expect(auditLogCount).toBe(1);
    expect(result.exclude).toContain('Session');
  });

  it('should strip AuditLog from include list', () => {
    const stored: StoredEntityFilter = { mode: 'include', entities: ['AuditLog', 'User'] };
    const result = toAuditFilterConfig(stored);
    expect(result.include).toEqual(['User']);
    expect(result.include).not.toContain('AuditLog');
  });

  it('should include actions when provided', () => {
    const stored: StoredEntityFilter = {
      mode: 'exclude',
      entities: [],
      actions: { Project: ['DELETE'] },
    };
    const result = toAuditFilterConfig(stored);
    expect(result.actions).toEqual({ Project: ['DELETE'] });
    expect(result.exclude).toContain('AuditLog');
  });

  it('should omit actions when empty object', () => {
    const stored: StoredEntityFilter = { mode: 'exclude', entities: [], actions: {} };
    const result = toAuditFilterConfig(stored);
    expect(result.actions).toBeUndefined();
  });

  it('should omit actions when undefined', () => {
    const stored: StoredEntityFilter = { mode: 'include', entities: ['User'] };
    const result = toAuditFilterConfig(stored);
    expect(result.actions).toBeUndefined();
  });

  it('should produce config compatible with shouldAudit', () => {
    const stored: StoredEntityFilter = {
      mode: 'exclude',
      entities: ['TenantConfig'],
      actions: { User: ['CREATE', 'DELETE'] },
    };
    const config = toAuditFilterConfig(stored);

    expect(shouldAudit('User', 'CREATE', config)).toBe(true);
    expect(shouldAudit('User', 'UPDATE', config)).toBe(false);
    expect(shouldAudit('TenantConfig', 'CREATE', config)).toBe(false);
    expect(shouldAudit('AuditLog', 'CREATE', config)).toBe(false);
    expect(shouldAudit('Role', 'UPDATE', config)).toBe(true);
  });
});

// ─── stableStringify ─────────────────────────────────────────────

describe('stableStringify', () => {
  it('should produce the same output regardless of key order', () => {
    const a = { before: { x: 1 }, after: { y: 2 }, updated: { z: 3 } };
    const b = { after: { y: 2 }, before: { x: 1 }, updated: { z: 3 } };
    const c = { updated: { z: 3 }, after: { y: 2 }, before: { x: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(b)).toBe(stableStringify(c));
  });

  it('should sort nested object keys recursively', () => {
    const obj = { z: { b: 2, a: 1 }, a: { d: 4, c: 3 } };
    expect(stableStringify(obj)).toBe('{"a":{"c":3,"d":4},"z":{"a":1,"b":2}}');
  });

  it('should handle arrays (preserve order)', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('should handle primitives', () => {
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
  });

  it('should handle empty objects and arrays', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify([])).toBe('[]');
  });

  it('should serialize Date objects the same as their ISO string (jsonb round-trip)', () => {
    const date = new Date('2026-03-01T18:04:20.200Z');
    const dateStr = '2026-03-01T18:04:20.200Z';
    // At creation time: changes contain Date objects
    // After jsonb round-trip: dates become plain strings
    // Both must produce the same hash input
    expect(stableStringify(date)).toBe(stableStringify(dateStr));
  });

  it('should handle objects with Date values consistently before/after jsonb', () => {
    // Simulates what the audit middleware produces (Date objects in result)
    const atCreation = { after: { name: 'Test', createdAt: new Date('2026-03-01T10:00:00.000Z') } };
    // Simulates what comes back from jsonb (dates are strings)
    const afterJsonb = { after: { name: 'Test', createdAt: '2026-03-01T10:00:00.000Z' } };
    expect(stableStringify(atCreation)).toBe(stableStringify(afterJsonb));
  });
});

// ─── computeAuditHash ────────────────────────────────────────────

describe('computeAuditHash', () => {
  const basePayload: AuditHashPayload = {
    action: 'CREATE',
    entity: 'User',
    entityId: 'user-123',
    userId: 'admin-1',
    tenantSlug: 'acme',
    changes: { after: { name: 'John' } },
    timestamp: '2026-03-01T10:00:00.000Z',
    previousHash: null,
  };

  it('should return a 64-character hex string (SHA-256)', () => {
    const hash = computeAuditHash(basePayload);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should be deterministic (same input → same output)', () => {
    const hash1 = computeAuditHash(basePayload);
    const hash2 = computeAuditHash(basePayload);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different data', () => {
    const hash1 = computeAuditHash(basePayload);
    const hash2 = computeAuditHash({ ...basePayload, action: 'DELETE' });
    expect(hash1).not.toBe(hash2);
  });

  it('should include previousHash in the computation', () => {
    const hash1 = computeAuditHash({ ...basePayload, previousHash: null });
    const hash2 = computeAuditHash({ ...basePayload, previousHash: 'abc123' });
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hashes when timestamp differs', () => {
    const hash1 = computeAuditHash(basePayload);
    const hash2 = computeAuditHash({ ...basePayload, timestamp: '2026-03-01T11:00:00.000Z' });
    expect(hash1).not.toBe(hash2);
  });

  it('should handle missing optional fields (userId, tenantSlug, changes)', () => {
    const minimal: AuditHashPayload = {
      action: 'DELETE',
      entity: 'Role',
      entityId: 'role-1',
      timestamp: '2026-03-01T10:00:00.000Z',
      previousHash: null,
    };
    const hash = computeAuditHash(minimal);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce the same hash regardless of changes key order (jsonb round-trip)', () => {
    // Simulate: at creation time, changes has keys in insertion order
    const original = computeAuditHash({
      ...basePayload,
      changes: { before: { name: 'Old' }, after: { name: 'New' }, updated: { id: '1', name: 'New' } },
    });
    // Simulate: after jsonb round-trip, keys are alphabetically sorted
    const afterJsonb = computeAuditHash({
      ...basePayload,
      changes: { after: { name: 'New' }, before: { name: 'Old' }, updated: { id: '1', name: 'New' } },
    });
    expect(original).toBe(afterJsonb);
  });

  it('should form a chain where each hash depends on the previous', () => {
    const hash1 = computeAuditHash(basePayload);
    const hash2 = computeAuditHash({
      ...basePayload,
      entityId: 'user-456',
      timestamp: '2026-03-01T10:01:00.000Z',
      previousHash: hash1,
    });
    const hash3 = computeAuditHash({
      ...basePayload,
      entityId: 'user-789',
      timestamp: '2026-03-01T10:02:00.000Z',
      previousHash: hash2,
    });

    // All three hashes should be different
    expect(new Set([hash1, hash2, hash3]).size).toBe(3);

    // Modifying hash1 would change hash2's recomputation
    const tampered = computeAuditHash({
      ...basePayload,
      entityId: 'user-456',
      timestamp: '2026-03-01T10:01:00.000Z',
      previousHash: 'tampered-hash',
    });
    expect(tampered).not.toBe(hash2);
  });
});

// ─── CHAIN_RESET_HASH ────────────────────────────────────────────

describe('CHAIN_RESET_HASH', () => {
  it('should be a recognizable constant', () => {
    expect(CHAIN_RESET_HASH).toBe('__CHAIN_RESET__');
  });
});

// ─── BATCH_DETAIL_LIMIT ──────────────────────────────────────────

describe('BATCH_DETAIL_LIMIT', () => {
  it('should be 100', () => {
    expect(BATCH_DETAIL_LIMIT).toBe(100);
  });
});
