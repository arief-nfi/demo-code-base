import { googleEventId } from './google-event-id';

describe('googleEventId', () => {
  it('same input, same id; different key, different id', () => {
    const id = googleEventId('acme', 'u1', 'sample-plugin', 'article:42');

    expect(googleEventId('acme', 'u1', 'sample-plugin', 'article:42')).toBe(id);
    expect(googleEventId('acme', 'u1', 'sample-plugin', 'article:43')).not.toBe(id);
    expect(googleEventId('beta', 'u1', 'sample-plugin', 'article:42')).not.toBe(id);
  });

  it('parts are not ambiguous when joined', () => {
    expect(googleEventId('acme', 'u1', 'a', 'b:c')).not.toBe(googleEventId('acme', 'u1', 'a:b', 'c'));
  });

  it('only characters 0-9 and a-v, 52 long', () => {
    for (const key of ['article:1', 'x', 'Ünïcode ✓', 'k'.repeat(200)]) {
      expect(googleEventId('acme', 'u1', 'sample-plugin', key)).toMatch(/^[0-9a-v]{52}$/);
    }
  });
});
