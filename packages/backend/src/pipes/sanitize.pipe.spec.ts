import { ArgumentMetadata } from '@nestjs/common';
import { SanitizePipe } from './sanitize.pipe';

describe('SanitizePipe', () => {
  let pipe: SanitizePipe;

  const bodyMetadata: ArgumentMetadata = { type: 'body', metatype: Object, data: '' };
  const queryMetadata: ArgumentMetadata = { type: 'query', metatype: Object, data: '' };

  beforeEach(() => {
    pipe = new SanitizePipe();
  });

  it('should trim whitespace from strings', () => {
    const result = pipe.transform('  hello world  ', bodyMetadata);
    expect(result).toBe('hello world');
  });

  it('should preserve HTML special characters (output encoding is the renderer\'s job)', () => {
    const result = pipe.transform('<script>alert("xss")</script>', bodyMetadata);
    expect(result).toBe('<script>alert("xss")</script>');
  });

  it('should preserve ampersands', () => {
    const result = pipe.transform('R&D Team', bodyMetadata);
    expect(result).toBe('R&D Team');
  });

  it('should preserve single quotes', () => {
    const result = pipe.transform("it's a test", bodyMetadata);
    expect(result).toBe("it's a test");
  });

  it('should be idempotent (no re-encoding on repeated saves)', () => {
    const once = pipe.transform('  R&D <Team>  ', bodyMetadata);
    const twice = pipe.transform(once, bodyMetadata);
    expect(twice).toBe('R&D <Team>');
  });

  it('should keep template markup intact', () => {
    const result = pipe.transform({ htmlContent: '<h1>Hello {{name}}</h1>' }, bodyMetadata);
    expect(result).toEqual({ htmlContent: '<h1>Hello {{name}}</h1>' });
  });

  it('should trim strings in objects', () => {
    const input = { name: '  <b>John</b>  ', email: 'john@test.com' };
    const result = pipe.transform(input, bodyMetadata);
    expect(result).toEqual({
      name: '<b>John</b>',
      email: 'john@test.com',
    });
  });

  it('should trim strings in arrays', () => {
    const input = ['  hello  ', '<script>'];
    const result = pipe.transform(input, bodyMetadata);
    expect(result).toEqual(['hello', '<script>']);
  });

  it('should handle nested objects', () => {
    const input = { user: { name: '  <b>Test</b>  ' } };
    const result = pipe.transform(input, bodyMetadata);
    expect(result).toEqual({ user: { name: '<b>Test</b>' } });
  });

  it('should preserve non-string values', () => {
    const input = { count: 42, active: true, tags: null };
    const result = pipe.transform(input, bodyMetadata);
    expect(result).toEqual({ count: 42, active: true, tags: null });
  });

  it('should NOT sanitize query parameters', () => {
    const result = pipe.transform('<script>', queryMetadata);
    expect(result).toBe('<script>');
  });

  it('should NOT sanitize param parameters', () => {
    const paramMetadata: ArgumentMetadata = { type: 'param', metatype: String, data: 'id' };
    const result = pipe.transform('<script>', paramMetadata);
    expect(result).toBe('<script>');
  });
});
