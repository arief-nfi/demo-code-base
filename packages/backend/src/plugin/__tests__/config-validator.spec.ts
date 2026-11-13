import { validatePluginConfig } from '../config-validator';

describe('validatePluginConfig', () => {
  it('should accept a valid config object', () => {
    const result = validatePluginConfig({ retentionDays: 90, enableNotifications: true });
    expect(result).toEqual({ valid: true });
  });

  it('should reject null', () => {
    const result = validatePluginConfig(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('plain object');
  });

  it('should reject undefined', () => {
    const result = validatePluginConfig(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('plain object');
  });

  it('should reject arrays', () => {
    const result = validatePluginConfig([1, 2, 3]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('plain object');
  });

  it('should reject strings', () => {
    const result = validatePluginConfig('hello');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('plain object');
  });

  it('should reject circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = validatePluginConfig(obj);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('circular');
  });

  it('should reject oversized config (> 64KB)', () => {
    const config: Record<string, string> = {};
    // Each value ~1KB, need ~65 entries
    const largeValue = 'x'.repeat(1024);
    for (let i = 0; i < 65; i++) {
      config[`key${i}`] = largeValue;
    }
    const result = validatePluginConfig(config);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('maximum size');
  });

  it('should reject deeply nested config (> 5 levels)', () => {
    // Build 6-level deep object
    let config: Record<string, unknown> = { value: 'deep' };
    for (let i = 0; i < 5; i++) {
      config = { nested: config };
    }
    const result = validatePluginConfig(config);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('nesting depth');
  });

  it('should accept config at exactly 5 levels deep', () => {
    // Build 5-level deep object
    let config: Record<string, unknown> = { value: 'deep' };
    for (let i = 0; i < 4; i++) {
      config = { nested: config };
    }
    const result = validatePluginConfig(config);
    expect(result).toEqual({ valid: true });
  });

  it('should reject config with too many keys (> 100)', () => {
    const config: Record<string, number> = {};
    for (let i = 0; i < 101; i++) {
      config[`k${i}`] = i;
    }
    const result = validatePluginConfig(config);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('key count');
  });

  it('should count nested keys toward the total', () => {
    // 50 top-level + 51 nested = 101 total
    const config: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      config[`k${i}`] = i;
    }
    const nested: Record<string, number> = {};
    for (let i = 0; i < 51; i++) {
      nested[`n${i}`] = i;
    }
    config.nested = nested;
    const result = validatePluginConfig(config);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('key count');
  });

  it('should accept empty config', () => {
    const result = validatePluginConfig({});
    expect(result).toEqual({ valid: true });
  });
});
