import { legacyHtmlEncode, hasLegacyEncodableChars } from './legacy-password';

describe('legacyHtmlEncode', () => {
  it('encodes the five characters the old SanitizePipe escaped', () => {
    expect(legacyHtmlEncode(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#x27;f');
  });

  it('encodes & first, so the entities it produces are not double-encoded', () => {
    expect(legacyHtmlEncode('<')).toBe('&lt;');
    expect(legacyHtmlEncode('&lt;')).toBe('&amp;lt;');
  });

  it('trims before encoding, like the old pipe', () => {
    expect(legacyHtmlEncode('  p&ss  ')).toBe('p&amp;ss');
  });

  it('leaves other characters untouched', () => {
    expect(legacyHtmlEncode('Passw0rd!@#$%^*()_+-=[]{}|;:,./?`~')).toBe('Passw0rd!@#$%^*()_+-=[]{}|;:,./?`~');
  });
});

describe('hasLegacyEncodableChars', () => {
  it.each(['&', '<', '>', '"', "'"])('is true for a password containing %s', (ch) => {
    expect(hasLegacyEncodableChars(`pass${ch}word`)).toBe(true);
  });

  it('is false for a password the old pipe would not have changed', () => {
    expect(hasLegacyEncodableChars('Passw0rd!@#$%^*()')).toBe(false);
  });
});
