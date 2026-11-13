import { redactSensitiveConfig } from '../config-redactor';

describe('redactSensitiveConfig', () => {
  it('should redact apiKey fields', () => {
    const config = { apiKey: 'secret-123', name: 'test' };
    const result = redactSensitiveConfig(config);
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.name).toBe('test');
  });

  it('should redact api_key fields', () => {
    const config = { api_key: 'secret-123' };
    const result = redactSensitiveConfig(config);
    expect(result.api_key).toBe('[REDACTED]');
  });

  it('should redact secret fields', () => {
    const config = { clientSecret: 'abc', publicData: 'visible' };
    const result = redactSensitiveConfig(config);
    expect(result.clientSecret).toBe('[REDACTED]');
    expect(result.publicData).toBe('visible');
  });

  it('should redact password fields', () => {
    const config = { dbPassword: 'hunter2' };
    const result = redactSensitiveConfig(config);
    expect(result.dbPassword).toBe('[REDACTED]');
  });

  it('should redact token fields', () => {
    const config = { accessToken: 'tok-123', refreshToken: 'ref-456' };
    const result = redactSensitiveConfig(config);
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
  });

  it('should redact credential fields', () => {
    const config = { credentials: 'user:pass' };
    const result = redactSensitiveConfig(config);
    expect(result.credentials).toBe('[REDACTED]');
  });

  it('should redact private_key fields', () => {
    const config = { private_key: 'key-data', privateKey: 'key-data-2' };
    const result = redactSensitiveConfig(config);
    expect(result.private_key).toBe('[REDACTED]');
    expect(result.privateKey).toBe('[REDACTED]');
  });

  it('should redact connection_string fields', () => {
    const config = { connectionString: 'postgres://user:pass@host/db' };
    const result = redactSensitiveConfig(config);
    expect(result.connectionString).toBe('[REDACTED]');
  });

  it('should preserve non-sensitive fields', () => {
    const config = { retentionDays: 90, enableNotifications: true, name: 'audit' };
    const result = redactSensitiveConfig(config);
    expect(result).toEqual(config);
  });

  it('should redact nested sensitive fields', () => {
    const config = {
      database: {
        password: 'hunter2',
        host: 'localhost',
      },
      name: 'test',
    };
    const result = redactSensitiveConfig(config);
    expect((result.database as Record<string, unknown>).password).toBe('[REDACTED]');
    expect((result.database as Record<string, unknown>).host).toBe('localhost');
    expect(result.name).toBe('test');
  });

  it('should handle empty config', () => {
    const result = redactSensitiveConfig({});
    expect(result).toEqual({});
  });

  it('should not recurse into arrays', () => {
    const config = { tags: ['secret', 'password'], name: 'test' };
    const result = redactSensitiveConfig(config);
    expect(result.tags).toEqual(['secret', 'password']);
    expect(result.name).toBe('test');
  });
});
