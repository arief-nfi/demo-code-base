import { PluginManifests } from '../plugin-registry';

/** The plugins a plugin needs switched on first. */
export type DepsOf = (pluginKey: string) => string[];

/** Dependencies declared in each plugin's manifest (`pluginDependencies`). */
export const manifestDeps: DepsOf = (pluginKey) => Object.keys(PluginManifests[pluginKey]?.pluginDependencies ?? {});

/**
 * `keys` ordered so every plugin comes after the ones it needs (within `keys`);
 * otherwise the given order is kept. A dependency cycle doesn't loop.
 */
export function dependenciesFirst(keys: string[], depsOf: DepsOf): string[] {
  const inSet = new Set(keys);
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: string[] = [];
  const visit = (key: string) => {
    if (done.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (const dep of depsOf(key)) if (inSet.has(dep)) visit(dep);
    visiting.delete(key);
    done.add(key);
    out.push(key);
  };
  keys.forEach(visit);
  return out;
}

/** Enabled plugins outside `keys` that need (directly or through others) any of `keys`, dependents first. */
export function dependentsOf(keys: string[], enabled: string[], depsOf: DepsOf): string[] {
  const affected = new Set(keys);
  for (let grew = true; grew; ) {
    grew = false;
    for (const key of enabled) {
      if (!affected.has(key) && depsOf(key).some((dep) => affected.has(dep))) {
        affected.add(key);
        grew = true;
      }
    }
  }
  const dependents = enabled.filter((key) => affected.has(key) && !keys.includes(key));
  return dependenciesFirst(dependents, depsOf).reverse();
}
