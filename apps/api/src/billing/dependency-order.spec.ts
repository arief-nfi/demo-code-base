import { dependenciesFirst, dependentsOf } from './dependency-order';

const deps: Record<string, string[]> = { procurement: ['inventory'], reports: ['procurement'] };
const depsOf = (k: string) => deps[k] ?? [];

describe('dependency order', () => {
  it('dependencies come first', () => {
    expect(dependenciesFirst(['reports', 'procurement', 'inventory'], depsOf)).toEqual(['inventory', 'procurement', 'reports']);
  });

  it('keeps the given order for unrelated plugins', () => {
    expect(dependenciesFirst(['b', 'a'], depsOf)).toEqual(['b', 'a']);
  });

  it('ignores dependencies outside the set and survives a cycle', () => {
    expect(dependenciesFirst(['reports'], depsOf)).toEqual(['reports']);
    const cyclic = (k: string) => (k === 'a' ? ['b'] : k === 'b' ? ['a'] : []);
    expect(dependenciesFirst(['a', 'b'], cyclic).sort()).toEqual(['a', 'b']);
  });

  it('finds enabled dependents outside the set, transitively, dependents first', () => {
    expect(dependentsOf(['inventory'], ['inventory', 'procurement', 'reports', 'docs'], depsOf)).toEqual(['reports', 'procurement']);
    expect(dependentsOf(['inventory'], ['inventory', 'reports'], depsOf)).toEqual([]);
  });
});
